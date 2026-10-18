/**
 * Phase 8 checks: panel interview scheduling (slots, candidate choice, reschedule, cancel, calendar files), interview
 * kits, independent scorecards, debrief, final decision and candidate notification, reminders, roles and isolation.
 * Uses a candidate whose AI rounds are finished (run `npm run smoke` first).
 *   BASE_URL=http://localhost:3000 npx tsx scripts/smoke-phase8.ts
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

const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

async function main() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const q = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows as T[];
  const stamp = Date.now();
  const admin = await new Client().login(process.env.ADMIN_EMAIL!, process.env.ADMIN_PASSWORD!);
  const [{ org_id: orgId }] = await q<{ org_id: string }>("select org_id from users where email = $1", [process.env.ADMIN_EMAIL!.toLowerCase()]);

  // A candidate with a ready combined report, reset to "AI rounds finished" so the script can run repeatedly.
  const [c] = await q<{ id: string; drive_id: string; access_token: string; name: string }>(
    `select c.id, c.drive_id, c.access_token, cand.name from candidacies c join candidates cand on cand.id = c.candidate_id
       join combined_reports r on r.candidacy_id = c.id
      where c.org_id = $1 and r.status = 'ready' and c.stage in ('completed', 'shortlisted', 'panel', 'offer')
      order by c.created_at desc limit 1`,
    [orgId],
  );
  if (!c) throw new Error("Need a candidate who has finished the AI rounds — run `npm run smoke` first");
  await q("delete from panel_interviews where candidacy_id = $1", [c.id]);
  await q("delete from hiring_decisions where candidacy_id = $1", [c.id]);
  await q("update candidacies set stage = 'completed', final_status = null where id = $1", [c.id]);

  const pw = "Copper-Meadow-84";
  const mk = async (name: string, role: string, driveIds?: string[]) => {
    const email = `${name.toLowerCase().replace(/\s/g, ".")}.${stamp}@panel.test`;
    const { id } = await admin.json<{ id: string }>("POST", "/api/settings/users", { name, email, password: pw, role });
    if (driveIds) await admin.json("PUT", `/api/settings/users/${id}`, { driveIds });
    return { id, email, client: await new Client().login(email, pw) };
  };
  const hm1 = await mk("Priya Panel", "hiring_manager", [c.drive_id]);
  const hm2 = await mk("Omar Panel", "hiring_manager", [c.drive_id]);
  const hmOther = await mk("Uma Unassigned", "hiring_manager", []);
  const viewer = await mk("Vic Viewer", "viewer");
  const recruiter = await mk("Rosa Recruiter", "recruiter");
  const cand = new Client();

  /* ------------------------------- Scheduling ------------------------------- */
  const base = { title: "Final panel interview", durationMin: 45, location: "https://meet.example.com/hbe-panel", competencies: ["Technical depth", "Communication", "Collaboration"] };
  const sched = (cl: Client, body: Record<string, unknown>) => cl.req("POST", `/api/candidacies/${c.id}/panel`, { ...base, ...body });
  check((await sched(hm1.client, { slots: [inHours(48)], panelistIds: [hm1.id] })).status === 403, "hiring managers can't arrange panels (recruiters and admins do)");
  check((await sched(viewer.client, { slots: [inHours(48)], panelistIds: [hm1.id] })).status === 403, "viewers can't arrange panels");
  check((await sched(recruiter.client, { slots: [inHours(48)], panelistIds: [hmOther.id] })).status === 400, "hiring managers not assigned to the drive can't sit on its panel");
  check((await sched(recruiter.client, { slots: [inHours(48)], panelistIds: [viewer.id] })).status === 400, "viewers can't sit on a panel");
  check((await sched(recruiter.client, { slots: [inHours(-2)], panelistIds: [hm1.id] })).status === 400, "past times are refused");
  const dup = inHours(50);
  check((await sched(recruiter.client, { slots: [dup, dup], panelistIds: [hm1.id] })).status === 400, "the same time can't be offered twice");
  check((await sched(recruiter.client, { slots: [inHours(48)], panelistIds: [hm1.id], competencies: [] })).status === 400, "a scorecard needs at least one competency");
  const slotA = inHours(48);
  const slotB = inHours(72);
  const created = await recruiter.client.json<{ id: string; status: string }>("POST", `/api/candidacies/${c.id}/panel`, { ...base, slots: [slotB, slotA], panelistIds: [hm1.id, hm2.id] });
  check(created.status === "proposed", "offering two times asks the candidate to choose");
  const ivId = created.id;
  const [stage1] = await q<{ stage: string }>("select stage from candidacies where id = $1", [c.id]);
  check(stage1.stage === "panel", "the candidate moves to the panel stage");
  const cards = await q("select 1 from panel_scorecards where interview_id = $1", [ivId]);
  check(cards.length === 2, "each panelist gets a scorecard to fill in");

  /* --------------------------- Candidate chooses ---------------------------- */
  const hub = await cand.req("GET", `/c/${c.access_token}`);
  check(hub.text.includes("Next step: meet the team") && hub.text.includes("Confirm this time") && hub.text.includes("None of these times work for me"), "the candidate is asked to pick a time");
  check(!hub.text.includes("Priya Panel"), "the candidate page doesn't name the panel");
  check((await cand.req("POST", `/api/c/${c.access_token}/panel/${ivId}/choose`, { slot: inHours(30) })).status === 400, "the candidate can only choose an offered time");
  check((await cand.req("GET", `/api/c/${c.access_token}/panel/${ivId}/ics`)).status === 409, "no calendar file before a time is chosen");
  await cand.json("POST", `/api/c/${c.access_token}/panel/${ivId}/choose`, { slot: slotA });
  const [booked] = await q<{ status: string; scheduled_at: Date }>("select status, scheduled_at from panel_interviews where id = $1", [ivId]);
  check(booked.status === "scheduled" && booked.scheduled_at.toISOString() === slotA, "choosing a time books the interview");
  check((await cand.req("POST", `/api/c/${c.access_token}/panel/${ivId}/choose`, { slot: slotB })).status === 409, "a booked interview can't be re-booked by choosing again");
  const ics = await cand.req("GET", `/api/c/${c.access_token}/panel/${ivId}/ics`);
  const dt = slotA.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  check(ics.type.includes("text/calendar") && ics.text.includes(`DTSTART:${dt}`) && ics.text.includes("LOCATION:https://meet.example.com/hbe-panel") && ics.text.includes("SEQUENCE:0"), "the candidate can download a calendar file for the booking");
  const staffIcs = await hm1.client.req("GET", `/api/panel/${ivId}/ics`);
  const unfolded = staffIcs.text.replace(/\r\n /g, ""); // RFC 5545 line folding
  check(staffIcs.status === 200 && unfolded.includes(`/app/panel/${ivId}`) && unfolded.includes(c.name.split(" ")[0]), "panelists get a calendar file linking to the interview kit");
  const audits = await q<{ action: string }>("select action from audit_log where entity_id = $1 and action like 'panel.%'", [c.id]);
  check(audits.some((a) => a.action === "panel.create") && audits.some((a) => a.action === "panel.slot_chosen"), "scheduling is audited");

  /* ------------------------------- Rescheduling ------------------------------ */
  await cand.json("POST", `/api/c/${c.access_token}/panel/${ivId}/other-times`, { message: "I'm travelling that day — any weekday after 4pm works." });
  const [rr] = await q<{ status: string; scheduled_at: Date | null; sequence: number }>("select status, scheduled_at, sequence from panel_interviews where id = $1", [ivId]);
  check(rr.status === "reschedule_requested" && !rr.scheduled_at && rr.sequence === 1, "the candidate can ask for other times (the booking is released)");
  const decisions = await recruiter.client.req("GET", "/app/gate-queue");
  check(decisions.text.includes("Panel interviews to reschedule") && decisions.text.includes("weekday after 4pm"), "recruiters see reschedule requests on the Decisions page");
  check((await hm1.client.req("POST", `/api/panel/${ivId}/reschedule`, { slots: [inHours(96)] })).status === 403, "hiring managers can't reschedule");
  const newSlot = inHours(96);
  const rs = await recruiter.client.json<{ status: string }>("POST", `/api/panel/${ivId}/reschedule`, { slots: [newSlot] });
  const [after] = await q<{ sequence: number; scheduled_at: Date }>("select sequence, scheduled_at from panel_interviews where id = $1", [ivId]);
  check(rs.status === "scheduled" && after.scheduled_at.toISOString() === newSlot && after.sequence === 2, "offering a single new time books it and bumps the calendar sequence");
  check((await cand.req("GET", `/api/c/${c.access_token}/panel/${ivId}/ics`)).text.includes("SEQUENCE:2"), "the updated calendar file replaces the earlier event");

  /* ------------------------------ Kits & roles ------------------------------- */
  check((await hm1.client.req("PUT", `/api/panel/${ivId}/scorecard`, { ratings: { "Technical depth": 4 }, recommendation: "hire" })).status === 409, "scorecards open only when the interview starts");
  const kit = await hm1.client.req("GET", `/app/panel/${ivId}`);
  check(kit.status === 200 && kit.text.includes("What to explore") && kit.text.includes("Your scorecard") && kit.text.includes("AI combined recommendation"), "panelists get an interview kit with the AI's focus areas");
  check((await hmOther.client.req("GET", `/app/panel/${ivId}`)).status === 404, "staff outside the drive can't open the kit");
  check((await viewer.client.req("GET", `/app/panel/${ivId}`)).status !== 200, "viewers can't open interview kits");
  const mine = await hm1.client.req("GET", "/app/panel");
  check(mine.text.includes(c.name) && mine.text.includes("Upcoming (1)"), "the panelist sees the interview under My interviews");

  // Time passes: the interview has started.
  await q("update panel_interviews set scheduled_at = now() - interval '50 minutes' where id = $1", [ivId]);

  /* ------------------------------- Scorecards -------------------------------- */
  check((await recruiter.client.req("PUT", `/api/panel/${ivId}/scorecard`, { ratings: { Communication: 3 }, recommendation: "hire" })).status === 403, "only panelists can submit a scorecard");
  check((await hm1.client.req("PUT", `/api/panel/${ivId}/scorecard`, { ratings: { Charisma: 5 }, recommendation: "hire" })).status === 400, "ratings must be for the interview's competencies");
  check((await hm1.client.req("PUT", `/api/panel/${ivId}/scorecard`, { ratings: { Communication: null }, recommendation: "hire" })).status === 400, "a scorecard needs at least one rating");
  const hm1Strength = "Explained the ledger design crisply and owned the trade-offs.";
  await hm1.client.json("PUT", `/api/panel/${ivId}/scorecard`, { ratings: { "Technical depth": 5, Communication: 4, Collaboration: 4 }, recommendation: "strong_hire", strengths: hm1Strength, concerns: "Light on testing detail." });
  const hm2Page = await hm2.client.req("GET", `/app/candidates/${c.id}`);
  check(hm2Page.text.includes("Submit your own scorecard to see") && !hm2Page.text.includes(hm1Strength), "a panelist who hasn't submitted can't see the others' scorecards (report page)");
  const hm2Kit = await hm2.client.req("GET", `/app/panel/${ivId}`);
  check(!hm2Kit.text.includes(hm1Strength) && hm2Kit.text.includes("Priya Panel") && hm2Kit.text.includes("✓ scorecard"), "…nor in the kit, though they can see who has submitted");
  check((await recruiter.client.req("GET", `/app/candidates/${c.id}`)).text.includes(hm1Strength), "people not on the panel see submitted scorecards");
  const hm2Concern = "Struggled to explain how they'd debug the outage scenario.";
  await hm2.client.json("PUT", `/api/panel/${ivId}/scorecard`, { ratings: { "Technical depth": 2, Communication: 3, Collaboration: 4 }, recommendation: "lean_no", concerns: hm2Concern });
  const debrief = await hm2.client.req("GET", `/app/candidates/${c.id}`);
  check(debrief.text.includes(hm1Strength) && debrief.text.includes(hm2Concern) && debrief.text.includes("panel split"), "after submitting, the panelist sees the full debrief, flagged as a split panel");
  await hm1.client.json("PUT", `/api/panel/${ivId}/scorecard`, { ratings: { "Technical depth": 5, Communication: 4, Collaboration: 5 }, recommendation: "strong_hire", strengths: hm1Strength });
  const [upd] = await q<{ ratings: Record<string, number> }>("select ratings from panel_scorecards where interview_id = $1 and panelist_id = $2", [ivId, hm1.id]);
  check(upd.ratings.Collaboration === 5, "a panelist can update their scorecard before the decision");

  /* -------------------------------- Reminders -------------------------------- */
  const second = await recruiter.client.json<{ id: string }>("POST", `/api/candidacies/${c.id}/panel`, { ...base, title: "Bar-raiser chat", slots: [inHours(24)], panelistIds: [hm1.id] });
  await q("update panel_interviews set scheduled_at = now() - interval '2 days' where id = $1", [second.id]);
  await waitFor("scorecard reminder", async () => (await q<{ reminded_at: Date | null }>("select reminded_at from panel_scorecards where interview_id = $1", [second.id]))[0]?.reminded_at, 70_000);
  check(true, "panelists with a scorecard still open a day after the interview get a reminder");
  await recruiter.client.json("POST", `/api/panel/${second.id}/cancel`, { reason: "Not needed after the panel." });
  const hubAfterCancel = await cand.req("GET", `/c/${c.access_token}`);
  check(!hubAfterCancel.text.includes("Bar-raiser chat"), "cancelled interviews disappear from the candidate page");

  /* ---------------------------- Tenant isolation ---------------------------- */
  const otherEmail = `iso8.${stamp}@iso.test`;
  await admin.json("POST", "/api/platform/orgs", { name: `Panel Iso ${stamp}`, admin: { name: "Ivo Admin", email: otherEmail, password: pw } });
  const other = await new Client().login(otherEmail, pw);
  check((await other.req("POST", `/api/candidacies/${c.id}/panel`, { ...base, slots: [inHours(48)], panelistIds: [hm1.id] })).status === 404, "another organisation can't arrange panels for this candidate");
  check((await other.req("GET", `/app/panel/${ivId}`)).status === 404, "another organisation can't open the kit");
  check((await other.req("GET", `/api/panel/${ivId}/ics`)).status === 404, "another organisation can't download the calendar file");
  check((await other.req("POST", `/api/panel/${ivId}/reschedule`, { slots: [inHours(48)] })).status === 404, "another organisation can't reschedule");
  check((await other.req("POST", `/api/candidacies/${c.id}/decision`, { decision: "reject", reason: "Not our candidate at all." })).status === 404, "another organisation can't decide");

  /* ----------------------------- Final decision ----------------------------- */
  check((await viewer.client.req("POST", `/api/candidacies/${c.id}/decision`, { decision: "offer", reason: "Strong panel feedback." })).status === 403, "viewers can't make the final decision");
  check((await hm1.client.req("POST", `/api/candidacies/${c.id}/decision`, { decision: "offer", reason: "ok" })).status === 400, "a decision needs real reasoning");
  await hm1.client.json("POST", `/api/candidacies/${c.id}/decision`, { decision: "hold", reason: "Waiting on headcount approval for Q1.", notifyCandidate: true });
  const [held] = await q<{ stage: string }>("select stage from candidacies where id = $1", [c.id]);
  const holdHub = await cand.req("GET", `/c/${c.access_token}`);
  check(held.stage === "on_hold" && !holdHub.text.includes("Good news") && !holdHub.text.includes("won't be moving forward"), "a hold is recorded without telling the candidate anything");
  await hm1.client.json("POST", `/api/candidacies/${c.id}/decision`, { decision: "offer", reason: "Strong technical depth; panel concerns about debugging are coachable.", notifyCandidate: true });
  const [offer] = await q<{ stage: string; final_status: string }>("select stage, final_status from candidacies where id = $1", [c.id]);
  check(offer.stage === "offer" && offer.final_status === "offer", "an offer moves the candidate to Offer");
  const [basis] = await q<{ basis: { ai: { recommendation: string } | null; panels: { split: boolean; submitted: number }[] }; candidate_notified_at: Date | null }>("select basis, candidate_notified_at from hiring_decisions where candidacy_id = $1 and decision = 'offer'", [c.id]);
  check(basis.basis.ai?.recommendation && basis.basis.panels.some((p) => p.split && p.submitted === 2) && basis.candidate_notified_at, "the decision records what it rested on (AI recommendation, panel split) and that the candidate was told");
  check((await cand.req("GET", `/c/${c.access_token}`)).text.includes("Good news!"), "the candidate sees the offer on their page");
  const report = await hm2.client.req("GET", `/app/candidates/${c.id}`);
  check(report.text.includes("Strong technical depth; panel concerns") && report.text.includes("candidate told"), "the decision and its reasoning appear on the report");
  check((await hm1.client.req("PUT", `/api/panel/${ivId}/scorecard`, { ratings: { Communication: 1 }, recommendation: "no_hire" })).status === 409, "scorecards lock once the final decision is made");
  const decAudit = await q("select 1 from audit_log where entity_id = $1 and action = 'decision.offer'", [c.id]);
  check(decAudit.length === 1, "the decision is audited");
  const [drive] = await q<{ id: string }>("select drive_id as id from candidacies where id = $1", [c.id]);
  check((await admin.req("GET", `/app/drives/${drive.id}/analytics`)).text.includes("Offer"), "drive analytics count offers");

  await db.end();
  console.log(`\nPHASE 8 CHECKS PASSED (${passed} checks)`);
}

main().catch((e) => {
  console.error("\nPHASE 8 CHECKS FAILED:", e);
  process.exit(1);
});
