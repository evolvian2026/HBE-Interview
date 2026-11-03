/**
 * Phase 18 checks: calendar sync — connecting a calendar (OAuth state, encrypted tokens), suggested free times,
 * automatic video links on booking, candidate choice, reschedule and cancel keeping events in line, failures that
 * never block scheduling, disconnecting, roles and isolation. Runs against a dev server with CALENDAR_MOCK=true.
 *   BASE_URL=http://localhost:3000 npx tsx scripts/smoke-phase18.ts
 */
import "./load-env";
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
let passed = 0;
function check(cond: unknown, msg: string) {
  if (!cond) throw new Error(`CHECK FAILED: ${msg}`);
  passed++;
  console.log("✓", msg);
}

class Client {
  cookies = new Map<string, string>();
  async req(method: string, path: string, body?: unknown) {
    const res = await fetch(BASE + path, {
      method,
      redirect: "manual",
      headers: {
        ...(this.cookies.size ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
        ...(body !== undefined ? { "content-type": "application/json", origin: BASE } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const sc of res.headers.getSetCookie()) {
      const [kv] = sc.split(";");
      const i = kv.indexOf("=");
      if (!kv.slice(i + 1) || /max-age=0/i.test(sc)) this.cookies.delete(kv.slice(0, i));
      else this.cookies.set(kv.slice(0, i), kv.slice(i + 1));
    }
    return { status: res.status, text: await res.text(), type: res.headers.get("content-type") ?? "" };
  }
  async json<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await this.req(method, path, body);
    if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status}: ${r.text}`);
    return JSON.parse(r.text || "{}") as T;
  }
  async login(email: string, password: string) {
    const r = await this.req("POST", "/api/auth/login", { email, password });
    if (r.status !== 200) throw new Error(`login ${email} → ${r.status} ${r.text}`);
    return this;
  }
}

async function waitFor<T>(label: string, fn: () => Promise<T | null | undefined | false>, timeoutMs = 90_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

type Q = <T = Record<string, unknown>>(sql: string, args?: unknown[]) => Promise<T[]>;
// Times in the future, on the hour (UTC), avoiding the mock calendar's 12:00 busy hour.
const slotAt = (daysAhead: number, hourUtc: number) => {
  const d = new Date(Date.now() + daysAhead * 86_400_000);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d.toISOString();
};

async function main() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const q: Q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const stamp = Date.now();
  await q("delete from rate_limits where key like 'login:ip:%' or key like 'cal-suggest:%'");
  const admin = await new Client().login(process.env.ADMIN_EMAIL!, process.env.ADMIN_PASSWORD!);
  const [{ org_id: orgId }] = await q<{ org_id: string }>("select org_id from users where email = $1", [process.env.ADMIN_EMAIL!.toLowerCase()]);
  const used: string[] = [];
  try {
    await run(admin, orgId, q, stamp, used);
  } finally {
    // Put the candidates back so the script can run again.
    if (used.length) {
      await q("delete from panel_interviews where candidacy_id = any($1::uuid[])", [used]);
      await q("update candidacies set stage = 'completed' where id = any($1::uuid[])", [used]);
    }
    await db.end();
  }
  console.log(`\nPHASE 18 CHECKS PASSED (${passed} checks)`);
}

async function run(admin: Client, orgId: string, q: Q, stamp: number, used: string[]) {
  const pw = "Lantern-Quarry-63";
  const mk = async (name: string, role: string, driveIds?: string[]) => {
    const email = `${name.toLowerCase().split(" ")[0]}.cal.${stamp}@hbe.local`;
    const { id } = await admin.json<{ id: string }>("POST", "/api/settings/users", { name, email, password: pw, role });
    if (driveIds) await admin.json("PUT", `/api/settings/users/${id}`, { driveIds });
    return { id, email, name, client: await new Client().login(email, pw) };
  };
  const cands = await q<{ id: string; drive_id: string; access_token: string }>(
    `select c.id, c.drive_id, c.access_token from candidacies c join combined_reports r on r.candidacy_id = c.id and r.status = 'ready'
      where c.org_id = $1 and c.stage = 'completed' and not exists (select 1 from hires h where h.candidacy_id = c.id) order by c.created_at desc limit 3`,
    [orgId],
  );
  if (cands.length < 3) throw new Error("Need 3 completed candidates — run `npm run smoke` first");
  used.push(...cands.map((c) => c.id));
  const drives = [...new Set(cands.map((c) => c.drive_id))];
  const rec = await mk("Rina Calendar", "recruiter");
  const rec2 = await mk("Ravi NoCal", "recruiter");
  const hm = await mk("Hari Calendar", "hiring_manager", drives);
  const hm2 = await mk("Hema NoCal", "hiring_manager", drives);
  const viewer = await mk("Vic Viewer", "viewer");

  /* -------------------------------- Connecting -------------------------------- */
  const sec = await rec.client.req("GET", "/app/security");
  check(sec.text.includes("Calendar") && sec.text.includes("Connect Test calendar"), "the Security page offers to connect a calendar");
  check((await rec.client.req("GET", "/api/calendar/connect/google")).status === 404, "providers that aren't set up can't be used");
  check((await viewer.client.req("GET", "/api/calendar/connect/mock")).status === 403, "viewers don't connect calendars");
  // Connect: the provider (mock) redirects straight back with a code and the state.
  const startRes = await fetch(BASE + "/api/calendar/connect/mock", { redirect: "manual", headers: { cookie: [...rec.client.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } });
  const callback = startRes.headers.get("location") ?? "";
  const stateCookie = (startRes.headers.getSetCookie().find((x) => x.startsWith("hbe_cal_state=")) ?? "").split(";")[0];
  check(startRes.status === 307 && callback.includes("/api/calendar/callback/mock") && callback.includes("state=") && !!stateCookie, "connecting sends the person to the provider with a one-time state");
  const cookieHeader = (extra = "") => [[...rec.client.cookies].map(([k, v]) => `${k}=${v}`).join("; "), extra].filter(Boolean).join("; ");
  const bad = await fetch(callback.replace(/state=[^&]+/, "state=forged"), { redirect: "manual", headers: { cookie: cookieHeader(stateCookie) } });
  check((bad.headers.get("location") ?? "").includes("calendar_error="), "a forged state is refused");
  const startRes2 = await fetch(BASE + "/api/calendar/connect/mock", { redirect: "manual", headers: { cookie: cookieHeader() } });
  const cb2 = startRes2.headers.get("location")!;
  const sc2 = (startRes2.headers.getSetCookie().find((x) => x.startsWith("hbe_cal_state=")) ?? "").split(";")[0];
  const ok = await fetch(cb2, { redirect: "manual", headers: { cookie: cookieHeader(sc2) } });
  check((ok.headers.get("location") ?? "").includes("calendar=connected"), "the provider's answer connects the calendar");
  const [conn] = await q<{ provider: string; account_email: string; refresh_token: string }>("select provider, account_email, refresh_token from calendar_connections where user_id = $1", [rec.id]);
  check(conn?.provider === "mock" && conn.account_email === rec.email && conn.refresh_token.startsWith("v1.") && !conn.refresh_token.includes("mock-refresh"), "the connection is stored with its token encrypted");
  check((await rec.client.req("GET", "/app/security?calendar=connected")).text.includes("Your calendar is connected."), "the person sees the calendar is connected");
  // The hiring manager connects too (same flow).
  const hs = await fetch(BASE + "/api/calendar/connect/mock", { redirect: "manual", headers: { cookie: [...hm.client.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } });
  const hsc = (hs.headers.getSetCookie().find((x) => x.startsWith("hbe_cal_state=")) ?? "").split(";")[0];
  await fetch(hs.headers.get("location")!, { redirect: "manual", headers: { cookie: [[...hm.client.cookies].map(([k, v]) => `${k}=${v}`).join("; "), hsc].join("; ") } });
  check((await q("select 1 from calendar_connections where user_id = $1", [hm.id])).length === 1, "panelists connect their own calendars");

  /* ----------------------------- Suggesting times ----------------------------- */
  check((await hm.client.req("POST", "/api/calendar/suggest", { panelistIds: [hm.id], durationMin: 60, timeZone: "UTC" })).status === 403, "only recruiters ask for suggested times");
  check((await rec.client.req("POST", "/api/calendar/suggest", { panelistIds: [hm.id], durationMin: 60, timeZone: "Mars/Base" })).status === 400, "an unknown time zone is refused");
  const sug = await rec.client.json<{ slots: string[]; checked: string[]; notConnected: string[] }>("POST", "/api/calendar/suggest", { panelistIds: [hm.id, hm2.id], durationMin: 60, timeZone: "UTC", days: 7, workStartHour: 6, workEndHour: 18 });
  check(sug.slots.length > 0 && sug.checked.includes(hm.name) && sug.notConnected.includes(hm2.name), "suggestions use connected calendars and name who isn't connected");
  const clash = sug.slots.some((s) => {
    const d = new Date(s);
    const h = d.getUTCHours();
    return h === 12 || d.getUTCDay() === 0 || d.getUTCDay() === 6;
  });
  check(!clash, "suggested times avoid busy time (12:00–13:00 in the test calendar) and weekends");

  /* ------------------------- Booking with a video link ------------------------- */
  const [c1, c2, c3] = cands;
  const panel = { title: "Final panel", durationMin: 60, competencies: ["Depth", "Communication"] };
  check((await rec2.client.req("POST", `/api/candidacies/${c1.id}/panel`, { ...panel, location: "", autoMeeting: true, slots: [slotAt(3, 9)], panelistIds: [hm2.id] })).status === 400, "an automatic video link needs someone with a connected calendar");
  check((await rec.client.req("POST", `/api/candidacies/${c1.id}/panel`, { ...panel, location: "", slots: [slotAt(3, 9)], panelistIds: [hm.id] })).status === 400, "without an automatic link, a location is required");
  const booked = await rec.client.json<{ id: string; status: string }>("POST", `/api/candidacies/${c1.id}/panel`, { ...panel, location: "", autoMeeting: true, slots: [slotAt(3, 9)], panelistIds: [hm.id, hm2.id] });
  const [iv1] = await q<{ status: string; location: string; calendar_event_id: string | null; calendar_owner_id: string | null; calendar_provider: string | null; calendar_error: string | null }>("select status, location, calendar_event_id, calendar_owner_id, calendar_provider, calendar_error from panel_interviews where id = $1", [booked.id]);
  check(iv1.status === "scheduled" && iv1.location.startsWith("https://meet.mock.test/") && !!iv1.calendar_event_id && iv1.calendar_owner_id === rec.id && !iv1.calendar_error, "booking creates the event in the scheduler's calendar with a video link");
  check((await new Client().req("GET", `/c/${c1.access_token}`)).text.includes(iv1.location), "the candidate gets the video link");
  const kit = await rec.client.req("GET", `/app/candidates/${c1.id}`);
  check(kit.text.includes("In the panel") && kit.text.includes("video link created automatically"), "staff see the interview is in the panel's calendars");

  /* --------------------- Candidate chooses; reschedule; cancel --------------------- */
  const proposed = await rec.client.json<{ id: string; status: string }>("POST", `/api/candidacies/${c2.id}/panel`, { ...panel, location: "", autoMeeting: true, slots: [slotAt(4, 9), slotAt(5, 14)], panelistIds: [hm.id] });
  const [p0] = await q<{ location: string; calendar_event_id: string | null }>("select location, calendar_event_id from panel_interviews where id = $1", [proposed.id]);
  check(proposed.status === "proposed" && !p0.calendar_event_id && p0.location.includes("link is sent when the time is booked"), "while the candidate chooses, there's no event yet");
  await new Client().json("POST", `/api/c/${c2.access_token}/panel/${proposed.id}/choose`, { slot: slotAt(5, 14) });
  const [p1] = await q<{ status: string; location: string; calendar_event_id: string | null }>("select status, location, calendar_event_id from panel_interviews where id = $1", [proposed.id]);
  check(p1.status === "scheduled" && p1.location.startsWith("https://meet.mock.test/") && !!p1.calendar_event_id, "when the candidate picks a time, the event and link are created");
  await rec.client.json("POST", `/api/panel/${proposed.id}/reschedule`, { slots: [slotAt(6, 9), slotAt(6, 15)] });
  const [p2] = await q<{ status: string; location: string; calendar_event_id: string | null }>("select status, location, calendar_event_id from panel_interviews where id = $1", [proposed.id]);
  check(p2.status === "proposed" && !p2.calendar_event_id && !p2.location.startsWith("https://"), "offering new times removes the old event");
  await new Client().json("POST", `/api/c/${c2.access_token}/panel/${proposed.id}/choose`, { slot: slotAt(6, 15) });
  const [p3] = await q<{ calendar_event_id: string | null; location: string }>("select calendar_event_id, location from panel_interviews where id = $1", [proposed.id]);
  check(!!p3.calendar_event_id && p3.calendar_event_id !== p1.calendar_event_id && p3.location.startsWith("https://"), "booking the new time creates a fresh event");
  await rec.client.json("POST", `/api/panel/${proposed.id}/cancel`, { reason: "Role filled internally" });
  const [p4] = await q<{ status: string; calendar_event_id: string | null }>("select status, calendar_event_id from panel_interviews where id = $1", [proposed.id]);
  check(p4.status === "cancelled" && !p4.calendar_event_id, "cancelling removes the event");

  /* --------------------- Problems never block scheduling --------------------- */
  await q("update calendar_connections set refresh_token = 'v1.broken.token.x', access_expires_at = now() - interval '1 hour' where user_id = $1", [rec.id]);
  const broken = await rec.client.json<{ id: string; status: string }>("POST", `/api/candidacies/${c3.id}/panel`, { ...panel, location: "Office, 3rd floor", slots: [slotAt(4, 10)], panelistIds: [hm2.id] });
  const [b1] = await q<{ status: string; calendar_error: string | null; location: string }>("select status, calendar_error, location from panel_interviews where id = $1", [broken.id]);
  check(broken.status === "scheduled" && b1.location === "Office, 3rd floor" && !!b1.calendar_error, "a calendar failure is reported but the interview is still booked");
  const [cErr] = await q<{ last_error: string | null }>("select last_error from calendar_connections where user_id = $1", [rec.id]);
  check(!!cErr.last_error, "the connection is marked as needing attention");
  check((await rec.client.req("GET", "/app/security")).text.includes("needs attention"), "the person is asked to reconnect");
  check((await rec.client.req("GET", `/app/candidates/${c3.id}`)).text.includes("Calendar update failed"), "staff see the calendar problem on the interview");

  /* -------------------------------- Disconnect -------------------------------- */
  await rec.client.json("DELETE", "/api/calendar");
  check((await q("select 1 from calendar_connections where user_id = $1", [rec.id])).length === 0, "people can disconnect their calendar");
  const acts = (await q<{ action: string }>("select distinct action from audit_log where org_id = $1 and action like 'calendar.%'", [orgId])).map((a) => a.action);
  check(acts.includes("calendar.connect") && acts.includes("calendar.disconnect"), "connecting and disconnecting are audited");

  /* --------------------------------- Isolation --------------------------------- */
  const otherEmail = `cal-iso.${stamp}@iso.test`;
  await admin.json("POST", "/api/platform/orgs", { name: `Cal Iso ${stamp}`, admin: { name: "Ida Admin", email: otherEmail, password: pw } });
  const oth = await new Client().login(otherEmail, pw);
  check((await oth.req("POST", "/api/calendar/suggest", { panelistIds: [hm.id], durationMin: 60, timeZone: "UTC" })).status === 400, "another organisation can't read these people's availability");
}

main().catch((e) => {
  console.error("\nPHASE 18 CHECKS FAILED:", e);
  process.exit(1);
});
