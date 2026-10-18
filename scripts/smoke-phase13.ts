/**
 * Phase 13 checks: unscored practice interviews (availability, the practice run, no evaluation or stage change,
 * staff visibility without the transcript, practising again, hand-over to the real round, isolation, limits, setting).
 * Runs against a dev server with AI_MOCK=true.
 *   BASE_URL=http://localhost:3000 npx tsx scripts/smoke-phase13.ts
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

async function turn(token: string, sessionId: string, kind: string, text: string) {
  const res = await fetch(`${BASE}/api/c/${token}/sessions/${sessionId}/turns`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ clientMsgId: crypto.randomUUID(), kind, text }),
  });
  const raw = await res.text();
  if (res.status >= 400) return { status: res.status, ai: "", ended: false, section: undefined as string | undefined };
  const events = raw
    .split("\n\n")
    .map((c) => {
      const type = /event: (\w+)/.exec(c)?.[1];
      const data = /data: (.*)/.exec(c)?.[1];
      return type && data ? { type, data: JSON.parse(data) } : null;
    })
    .filter(Boolean) as { type: string; data: Record<string, unknown> }[];
  const err = events.find((e) => e.type === "error");
  if (err) throw new Error(`turn error: ${JSON.stringify(err.data)}`);
  const ai = events.filter((e) => e.type === "token").map((e) => e.data.text).join("");
  const done = events.find((e) => e.type === "done")?.data as { ended: boolean } | undefined;
  const state = [...events].reverse().find((e) => e.type === "state")?.data.state as { current: number; sections: { key: string }[] } | undefined;
  return { status: res.status, ai, ended: !!done?.ended, section: state?.sections[state.current]?.key };
}

type Q = <T = Record<string, unknown>>(sql: string, args?: unknown[]) => Promise<T[]>;

async function main() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const q: Q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const stamp = Date.now();
  const admin = await new Client().login(process.env.ADMIN_EMAIL!, process.env.ADMIN_PASSWORD!);
  const [{ org_id: orgId }] = await q<{ org_id: string }>("select org_id from users where email = $1", [process.env.ADMIN_EMAIL!.toLowerCase()]);
  try {
    await run(admin, orgId, q, stamp);
  } finally {
    // Always leave practice switched on (the default), even when a check fails part-way.
    await admin.json("PUT", "/api/settings", { practiceEnabled: true });
    await db.end();
  }
  console.log(`\nPHASE 13 CHECKS PASSED (${passed} checks)`);
}

async function invite(admin: Client, q: Q, orgId: string, name: string, stamp: number) {
  const [drive] = await q<{ id: string }>("select id from drives where org_id = $1 and status = 'active' order by created_at desc limit 1", [orgId]);
  const inv = await admin.json<{ results: { link: string }[] }>("POST", `/api/drives/${drive.id}/invites`, { candidates: [{ name, email: `${name.split(" ")[0].toLowerCase()}.${stamp}@example.com` }] });
  const token = inv.results[0].link.split("/c/")[1];
  const [{ id }] = await q<{ id: string }>("select id from candidacies where access_token = $1", [token]);
  return { token, cid: id, client: new Client() };
}

async function run(admin: Client, orgId: string, q: Q, stamp: number) {
  const settings = await admin.json<{ practiceEnabled: boolean }>("PUT", "/api/settings", { practiceEnabled: true });
  check(settings.practiceEnabled === true, "practice interviews are on for the organisation (the default)");
  check((await admin.req("GET", "/app/settings")).text.includes("practice interview"), "admins see the practice setting");

  /* ------------------------------ Availability ------------------------------ */
  const a = await invite(admin, q, orgId, "Pia Practice", stamp);
  check((await a.client.req("POST", `/api/c/${a.token}/practice/start`, { mode: "text" })).status === 409, "practice isn't available before consent and onboarding");
  check(!(await a.client.req("GET", `/c/${a.token}`)).text.includes("Try a practice"), "the hub doesn't offer practice before onboarding");
  check((await a.client.req("GET", `/c/${a.token}/practice`)).status === 307, "the practice page sends early visitors back to the hub");
  // Skip onboarding (covered by the main smoke test).
  await q("update candidacies set stage = 'ready', current_round_index = 0 where id = $1", [a.cid]);
  const hub = await a.client.req("GET", `/c/${a.token}`);
  check(hub.text.includes("Try a practice") && hub.text.includes("never scored or shared with the hiring team"), "the hub offers an optional, unscored practice once the candidate is ready");
  const lobby = await a.client.req("GET", `/c/${a.token}/practice`);
  check(lobby.status === 200 && lobby.text.includes("Practice interview (not scored)") && lobby.text.includes("Start practice"), "the practice lobby explains it isn't scored");
  check((await a.client.req("POST", `/api/c/${a.token}/practice/start`, { mode: "text", language: "xx" })).status === 400, "practice only runs in the role's interview languages");

  /* ------------------------------- Practice run ------------------------------ */
  const { sessionId } = await a.client.json<{ sessionId: string }>("POST", `/api/c/${a.token}/practice/start`, { mode: "text" });
  const again = await a.client.json<{ sessionId: string }>("POST", `/api/c/${a.token}/practice/start`, { mode: "text" });
  check(again.sessionId === sessionId, "starting again while practising rejoins the same session");
  const [sess] = await q<{ round_index: number; round_type: string; started_at: Date; deadline_at: Date; state: { sections: { key: string }[] } }>("select round_index, round_type, started_at, deadline_at, state from round_sessions where id = $1", [sessionId]);
  const minutes = (sess.deadline_at.getTime() - sess.started_at.getTime()) / 60_000;
  check(sess.round_index === -1 && Math.abs(minutes - 6) < 0.1, `the practice session is separate from the real rounds and lasts 6 minutes (${minutes.toFixed(1)})`);
  check(sess.state.sections.map((s) => s.key).join(",") === "practice_intro,practice_sample,wrapup", "practice has a warm-up, a sample question and tips");
  const [afterStart] = await q<{ stage: string; current_round_index: number }>("select stage, current_round_index from candidacies where id = $1", [a.cid]);
  check(afterStart.stage === "ready" && afterStart.current_round_index === 0, "starting practice doesn't change the candidate's stage");

  const open = await turn(a.token, sessionId, "open", "");
  check(/practice interview/i.test(open.ai) && /(nothing here is|not) scored/i.test(open.ai), "the interviewer opens by saying this is unscored practice");
  let t = open;
  let sawSample = false;
  for (let i = 0; i < 12 && !t.ended; i++) {
    t = await turn(a.token, sessionId, "answer", "I enjoy building reliable services and recently I fixed a slow database query by adding an index, which cut page load time in half for our users.");
    if (/technical problem you solved recently/.test(t.ai)) sawSample = true;
  }
  check(sawSample, "the sample question suits the role and isn't from the real interview");
  check(t.ended && /practice/i.test(t.ai), "the practice ends itself after the tips");
  const [ended] = await q<{ status: string }>("select status from round_sessions where id = $1", [sessionId]);
  check(ended.status === "ended", "the practice session is closed");
  const late = await turn(a.token, sessionId, "answer", "One more thing").catch((e: Error) => e);
  check(late instanceof Error && late.message.includes("has ended"), "a finished practice takes no more answers");
  await new Promise((r) => setTimeout(r, 1500));
  check((await q("select 1 from round_reports where session_id = $1", [sessionId])).length === 0, "practice is never evaluated (no report)");
  check((await q("select 1 from jobs where singleton_key = $1", [`evaluate:${sessionId}`])).length === 0, "no evaluation job is queued for practice");
  check((await q("select 1 from integrity_events where session_id = $1", [sessionId])).length === 0, "no integrity signals are kept for practice");
  const [afterEnd] = await q<{ stage: string; current_round_index: number }>("select stage, current_round_index from candidacies where id = $1", [a.cid]);
  check(afterEnd.stage === "ready" && afterEnd.current_round_index === 0, "finishing practice leaves the candidate ready for round 1");
  const audits = await q<{ action: string; org_id: string }>("select action, org_id from audit_log where entity_id = $1 order by created_at", [sessionId]);
  check(audits.map((x) => x.action).join(",") === "practice.start,practice.end" && audits.every((x) => x.org_id === orgId), "practice start and end are audited for the organisation");
  check((await q("select 1 from audit_log where action = 'round.end' and entity_id = $1", [sessionId])).length === 0, "practice doesn't count as a completed round");

  const hub2 = await a.client.req("GET", `/c/${a.token}`);
  check(hub2.text.includes("Practise again") && hub2.text.includes("Start round"), "the hub offers practising again next to the real round");
  check(!hub2.text.includes("How did"), "candidates aren't asked to rate the practice");
  check((await a.client.req("POST", `/api/c/${a.token}/feedback`, { roundIndex: -1, overall: 5, fairness: 5, clarity: 5 })).status === 400, "practice can't be rated as a round");

  /* ------------------------------ Staff visibility ----------------------------- */
  const staffPage = await admin.req("GET", `/app/candidates/${a.cid}`);
  check(staffPage.text.includes("practice taken") && staffPage.text.includes("Practice is never scored"), "staff see that the candidate practised");
  check(!staffPage.text.includes("cut page load time in half") && !staffPage.text.includes("short practice interview"), "staff never see the practice transcript");
  const exported = await a.client.json<{ rounds: { roundIndex: number; practice?: string }[] }>("GET", `/api/c/${a.token}/data`);
  check(exported.rounds.some((r) => r.roundIndex === -1 && r.practice?.includes("Unscored")), "the candidate's data download labels the practice session");

  /* ------------------------------ Practise again ------------------------------ */
  const second = await a.client.json<{ sessionId: string }>("POST", `/api/c/${a.token}/practice/start`, { mode: "voice" });
  check(second.sessionId !== sessionId, "practising again starts a fresh session");
  check((await q("select 1 from round_sessions where id = $1", [sessionId])).length === 0 && (await q("select 1 from messages where session_id = $1", [sessionId])).length === 0, "the previous practice and its messages are replaced");
  check((await admin.req("GET", `/app/candidates/${a.cid}`)).text.includes("practising now") && (await admin.req("GET", `/app/candidates/${a.cid}`)).text.includes("(2 times)"), "staff see practice in progress and the number of attempts");
  check((await a.client.req("GET", `/c/${a.token}`)).text.includes("Rejoin practice"), "the hub offers rejoining an unfinished practice");

  /* ------------------- The real round takes over from practice ------------------ */
  const real = await a.client.json<{ sessionId: string }>("POST", `/api/c/${a.token}/rounds/0/start`, { mode: "text" });
  const [prac] = await q<{ status: string; end_reason: string }>("select status, end_reason from round_sessions where id = $1", [second.sessionId]);
  check(prac.status === "ended" && prac.end_reason === "real_round_started", "starting the real round closes an open practice");
  const [realSess] = await q<{ round_index: number }>("select round_index from round_sessions where id = $1", [real.sessionId]);
  const [inRound] = await q<{ stage: string }>("select stage from candidacies where id = $1", [a.cid]);
  check(realSess.round_index === 0 && inRound.stage === "in_round", "the real round starts normally");
  check((await a.client.req("POST", `/api/c/${a.token}/practice/start`, { mode: "text" })).status === 409, "practice isn't available during a real round");
  check((await a.client.req("GET", `/c/${a.token}/practice`)).status === 307, "the practice page is closed during a real round");

  /* --------------------------------- Isolation -------------------------------- */
  const b = await invite(admin, q, orgId, "Ravi Other", stamp);
  await q("update candidacies set stage = 'ready', current_round_index = 0 where id = $1", [b.cid]);
  const bs = await b.client.json<{ sessionId: string }>("POST", `/api/c/${b.token}/practice/start`, { mode: "text" });
  check((await a.client.req("GET", `/api/c/${a.token}/sessions/${bs.sessionId}/state`)).status === 404, "a candidate can't open another candidate's practice");
  check((await turn(a.token, bs.sessionId, "answer", "hello")).status === 404, "a candidate can't answer in another candidate's practice");

  /* ------------------------------- Rate limit -------------------------------- */
  await q("update round_sessions set status = 'ended' where id = $1", [bs.sessionId]);
  let limited = 0;
  for (let i = 0; i < 6; i++) {
    const r = await b.client.req("POST", `/api/c/${b.token}/practice/start`, { mode: "text" });
    if (r.status === 429) limited++;
    else await q("update round_sessions set status = 'ended' where candidacy_id = $1 and round_index = -1", [b.cid]);
  }
  check(limited > 0, "practice attempts are limited per day");

  /* --------------------------------- Disabled --------------------------------- */
  await admin.json("PUT", "/api/settings", { practiceEnabled: false });
  const c = await invite(admin, q, orgId, "Cara Noprac", stamp);
  await q("update candidacies set stage = 'ready', current_round_index = 0 where id = $1", [c.cid]);
  check(!(await c.client.req("GET", `/c/${c.token}`)).text.includes("Try a practice"), "the hub doesn't offer practice when the organisation turns it off");
  check((await c.client.req("POST", `/api/c/${c.token}/practice/start`, { mode: "text" })).status === 403, "practice can't be started when it's turned off");
  check((await c.client.req("GET", `/c/${c.token}/practice`)).status === 307, "the practice page is closed when it's turned off");
}

main().catch((e) => {
  console.error("\nPHASE 13 CHECKS FAILED:", e);
  process.exit(1);
});
