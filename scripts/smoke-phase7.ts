/**
 * Phase 7 checks: blind calibration reviews (sampling, blind packet, submission, reveal, statistics, alerts, export,
 * isolation) and candidate accommodations (request, privacy, decision, applied clock and pauses, data export).
 * Runs against a dev server with AI_MOCK=true; uses rounds already evaluated by the earlier smoke tests.
 *   BASE_URL=http://localhost:3000 npx tsx scripts/smoke-phase7.ts
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

async function main() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const q = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows as T[];
  const stamp = Date.now();
  const admin = await new Client().login(process.env.ADMIN_EMAIL!, process.env.ADMIN_PASSWORD!);
  const [{ org_id: orgId }] = await q<{ org_id: string }>("select org_id from users where email = $1", [process.env.ADMIN_EMAIL!.toLowerCase()]);
  const before = await q<{ value: { calibration?: unknown } }>("select value from settings where key = $1", [`org:${orgId}`]);
  const originalCalibration = before[0]?.value?.calibration ?? { sampleRate: 10, includeLowConfidence: true };
  try {
    await run(admin, orgId, q, stamp);
  } finally {
    // Always put the organisation's sampling back, even when a check fails part-way.
    await admin.json("PUT", "/api/settings", { calibration: originalCalibration });
    await db.end();
  }
  console.log(`\nPHASE 7 CHECKS PASSED (${passed} checks)`);
}

type Q = <T = Record<string, unknown>>(sql: string, args?: unknown[]) => Promise<T[]>;

async function run(admin: Client, orgId: string, q: Q, stamp: number) {

  // Evaluated rounds that aren't the candidate's current round, so re-evaluating them doesn't move anyone along.
  const reports = await q<{ id: string; candidacy_id: string; drive_id: string; session_id: string; summary: string; name: string; round_type: string; updated_at: Date }>(
    `select r.id, r.candidacy_id, c.drive_id, r.session_id, r.summary, cand.name, r.round_type, r.updated_at
       from round_reports r join candidacies c on c.id = r.candidacy_id join candidates cand on cand.id = c.candidate_id
      where c.org_id = $1 and r.status = 'ready' and r.round_type = 'technical' and r.round_index < c.current_round_index
      order by r.created_at desc limit 4`,
    [orgId],
  );
  if (reports.length < 4) throw new Error("Need at least 4 evaluated technical rounds — run `npm run smoke` a few times first");
  // Reset these rounds so the script can run again on the same data.
  const ids = reports.map((r) => r.id);
  await q("delete from calibration_reviews where report_id = any($1::uuid[])", [ids]);
  await q("update round_reports set calibration_requested_at = null, calibration_reason = null where id = any($1::uuid[])", [ids]);
  const [rSample, rOff, rManual, rReview] = reports;

  /* ------------------------------- Settings -------------------------------- */
  check((await admin.req("PUT", "/api/settings", { calibration: { sampleRate: 150, includeLowConfidence: true } })).status === 400, "sample rate above 100% is refused");
  await admin.json("PUT", "/api/settings", { calibration: { sampleRate: 100, includeLowConfidence: true } });
  check((await admin.req("GET", "/app/settings")).text.includes("Blind calibration reviews"), "settings show the calibration sample rate");

  /* -------------------------------- Sampling -------------------------------- */
  const reEval = async (id: string, since: Date) => {
    await admin.json("POST", `/api/reports/${id}/reevaluate`, {});
    return waitFor(`re-evaluation of ${id}`, async () => {
      const [r] = await q<{ status: string; updated_at: Date; calibration_requested_at: Date | null; calibration_reason: string | null }>("select status, updated_at, calibration_requested_at, calibration_reason from round_reports where id = $1", [id]);
      return r.status === "ready" && r.updated_at > since ? r : null;
    });
  };
  const s1 = await reEval(rSample.id, new Date());
  check(s1.calibration_requested_at && ["sample", "low_confidence"].includes(s1.calibration_reason ?? ""), "a newly evaluated round is sampled for a blind review (100% sample)");
  await admin.json("PUT", "/api/settings", { calibration: { sampleRate: 0, includeLowConfidence: false } });
  const s2 = await reEval(rOff.id, new Date());
  check(!s2.calibration_requested_at, "sampling off: newly evaluated rounds aren't queued");

  /* ------------------------------ Staff accounts ----------------------------- */
  const pw = "Lantern-Quarry-63";
  const mk = async (name: string, role: string, driveIds?: string[]) => {
    const email = `${name.toLowerCase().split(" ")[0]}.${stamp}@hbe.local`;
    const { id } = await admin.json<{ id: string }>("POST", "/api/settings/users", { name, email, password: pw, role });
    if (driveIds) await admin.json("PUT", `/api/settings/users/${id}`, { driveIds });
    return { id, client: await new Client().login(email, pw) };
  };
  const hm = await mk("Hari Manager", "hiring_manager", [rReview.drive_id, rSample.drive_id, rManual.drive_id]);
  const otherDrive = (await q<{ id: string }>("select id from drives where org_id = $1 and id <> all($2::uuid[]) limit 1", [orgId, [rReview.drive_id, rSample.drive_id, rManual.drive_id]]))[0];
  const hmElsewhere = otherDrive ? await mk("Hema Elsewhere", "hiring_manager", [otherDrive.id]) : null;
  const viewer = await mk("Vik Viewer", "viewer");
  const recruiter = await mk("Rita Recruiter", "recruiter");

  /* ---------------------------- Manual request ------------------------------ */
  check((await viewer.client.req("POST", `/api/reports/${rManual.id}/calibration`, {})).status === 403, "viewers can't request blind reviews");
  await hm.client.json("POST", `/api/reports/${rManual.id}/calibration`, {});
  const [man] = await q<{ calibration_reason: string }>("select calibration_reason from round_reports where id = $1", [rManual.id]);
  check(man.calibration_reason === "requested", "a hiring manager can ask for a blind review of a round");
  await hm.client.json("POST", `/api/reports/${rReview.id}/calibration`, {});

  /* ---------------------------------- Queue --------------------------------- */
  const queue = await hm.client.req("GET", "/app/calibration");
  check(queue.status === 200 && queue.text.includes(`/app/calibration/${rReview.id}`) && queue.text.includes(`/app/calibration/${rManual.id}`), "queued rounds appear on the Calibration page");
  check(!queue.text.includes("By evaluator version") && !queue.text.includes("Export CSV"), "hiring managers see the queue but not the organisation-wide statistics");
  check((await viewer.client.req("GET", "/app/calibration")).status !== 200, "viewers can't open Calibration");
  if (hmElsewhere) {
    const other = await hmElsewhere.client.req("GET", "/app/calibration");
    check(!other.text.includes(rReview.id), "hiring managers only see rounds from drives assigned to them");
    check((await hmElsewhere.client.req("GET", `/app/calibration/${rReview.id}`)).status === 404, "a hiring manager can't open a blind review for another drive");
  }

  /* ------------------------------ Blind packet ------------------------------ */
  const blind = await hm.client.req("GET", `/app/calibration/${rReview.id}`);
  const [firstMsg] = await q<{ content: string }>("select content from messages where session_id = $1 and role = 'candidate' order by seq limit 1", [rReview.session_id]);
  const [paramsRow] = await q<{ params: Record<string, { justification: string; score: number }> }>("select params from round_reports where id = $1", [rReview.id]);
  const justification = Object.values(paramsRow.params).find((p) => p.justification?.length > 30)?.justification ?? "";
  check(blind.status === 200 && blind.text.includes("Your scores") && blind.text.includes(firstMsg.content.slice(0, 40).replace(/'/g, "&#x27;")), "the blind review shows the transcript and a scoring form");
  check(!blind.text.includes(rReview.name), "the blind review hides the candidate's name");
  check(!!rReview.summary && !blind.text.includes(rReview.summary.slice(0, 60)) && (!justification || !blind.text.includes(justification.slice(0, 60))), "the blind review hides the AI's summary and justifications");
  check(!/\d+\/100/.test(blind.text) && !blind.text.includes("Strong Hire</span>") && !blind.text.includes("confidence:"), "the blind review hides the AI's scores and recommendation");

  /* --------------------------------- Submit --------------------------------- */
  const technical = ["role_fit", "authenticity", "code_quality", "problem_solving", "communication"];
  const allOnes = Object.fromEntries(technical.map((p) => [p, 1]));
  check((await viewer.client.req("POST", `/api/calibration/${rReview.id}`, { scores: allOnes, recommendation: "no_hire" })).status === 403, "viewers can't submit reviews");
  check((await hm.client.req("POST", `/api/calibration/${rReview.id}`, { scores: { made_up: 3 }, recommendation: "hire" })).status === 400, "unknown parameters are refused");
  check((await hm.client.req("POST", `/api/calibration/${rReview.id}`, { scores: { role_fit: 7 }, recommendation: "hire" })).status === 400, "scores outside 1–5 are refused");
  check((await hm.client.req("POST", `/api/calibration/${rReview.id}`, { scores: { role_fit: null }, recommendation: "hire" })).status === 400, "a review must score at least one parameter");
  const sub = await hm.client.json<{ disagrees: boolean; comparison: { maxGap: number } }>("POST", `/api/calibration/${rReview.id}`, { scores: { ...allOnes, communication: null }, recommendation: "no_hire", notes: "Answers were generic." });
  check(sub.disagrees && sub.comparison.maxGap >= 2, "a review far from the AI is recorded as a disagreement (and the AI's scores are revealed only now)");
  const [saved] = await q<{ blind: boolean; scores: Record<string, number>; ai: { scores: Record<string, number>; recommendation: string; evaluator: string } }>("select blind, scores, ai from calibration_reviews where report_id = $1 and reviewer_id = $2", [rReview.id, hm.id]);
  check(saved.blind && !("communication" in saved.scores) && saved.ai.evaluator && Object.keys(saved.ai.scores).length >= 4, "the review is blind, skips 'not enough evidence' and freezes the AI's scores and evaluator version");
  check((await hm.client.req("POST", `/api/calibration/${rReview.id}`, { scores: allOnes, recommendation: "no_hire" })).status === 409, "a reviewer can review a round only once");
  const reveal = await hm.client.req("GET", `/app/calibration/${rReview.id}`);
  check(reveal.text.includes("You and the AI") && reveal.text.includes("disagreement") && reveal.text.includes("Answers were generic."), "after submitting, the reviewer sees their scores beside the AI's");
  check(!(await hm.client.req("GET", "/app/calibration")).text.includes(`/app/calibration/${rReview.id}"`), "a reviewed round leaves the queue");

  // The admin opens the full report first, then reviews in line with the AI: not blind, not a disagreement.
  await admin.req("GET", `/app/candidates/${rReview.candidacy_id}`);
  const agree = await admin.json<{ disagrees: boolean }>("POST", `/api/calibration/${rReview.id}`, { scores: saved.ai.scores, recommendation: saved.ai.recommendation });
  const [adminRev] = await q<{ blind: boolean }>("select r.blind from calibration_reviews r join users u on u.id = r.reviewer_id where r.report_id = $1 and u.email = $2", [rReview.id, process.env.ADMIN_EMAIL!.toLowerCase()]);
  check(!agree.disagrees && !adminRev.blind, "a reviewer who had opened the AI report is recorded as not blind; matching scores agree");

  const candPage = await hm.client.req("GET", `/app/candidates/${rReview.candidacy_id}`);
  check(candPage.text.includes("A blind human review disagreed with the AI") && candPage.text.includes("A blind human review agreed with the AI"), "the candidate report shows both reviews to decision makers");

  /* -------------------------------- Statistics ------------------------------- */
  const statsBlind = await admin.req("GET", "/app/calibration?days=30");
  const statsAll = await admin.req("GET", "/app/calibration?days=30&all=1");
  check(statsBlind.text.includes("Technical / Functional Round") && statsBlind.text.includes("Within 1") && statsBlind.text.includes("Code Quality"), "admins see agreement per parameter");
  check(statsAll.text.includes("Including non-blind reviews") && statsBlind.text.includes("Blind reviews only"), "statistics default to blind reviews and can include the rest");
  check((await recruiter.client.req("GET", "/app/calibration")).text.includes("By evaluator version"), "recruiters see the statistics");
  // Ten synthetic blind reviews where the AI is far more generous on Code Quality than people → a drift alert.
  for (let i = 0; i < 10; i++)
    await q(
      `insert into calibration_reviews (org_id, report_id, candidacy_id, drive_id, round_type, reviewer_id, scores, recommendation, ai, blind, disagrees)
       values ($1, $2, $3, $4, 'technical', null, '{"code_quality": 1}', 'no_hire', '{"scores": {"code_quality": 4}, "recommendation": "hire", "evaluator": "smoke-synthetic", "prompt": "evaluate_round@1"}', true, true)`,
      [orgId, rSample.id, rSample.candidacy_id, rSample.drive_id],
    );
  const drift = await admin.req("GET", "/app/calibration?days=30");
  check(drift.text.includes("The AI is drifting from your reviewers") && drift.text.includes("Code Quality (technical)") && drift.text.includes("smoke-synthetic"), "a consistent gap over 10+ reviews raises a drift alert and shows by evaluator version");
  const csv = await admin.req("GET", "/api/calibration/export?days=30");
  check(csv.type.includes("text/csv") && csv.text.startsWith("reviewed_at,drive,round") && csv.text.includes('"code_quality","1","4"'), "calibration reviews export as CSV, one row per parameter");
  check((await hm.client.req("GET", "/api/calibration/export")).status === 403, "hiring managers can't export calibration data");
  await q("delete from calibration_reviews where reviewer_id is null and ai->>'evaluator' = 'smoke-synthetic'");

  /* ---------------------------- Tenant isolation ---------------------------- */
  const otherAdminEmail = `iso-admin.${stamp}@iso.test`;
  await admin.json("POST", "/api/platform/orgs", { name: `Isolation ${stamp}`, admin: { name: "Ira Admin", email: otherAdminEmail, password: pw } });
  const otherAdmin = await new Client().login(otherAdminEmail, pw);
  check((await otherAdmin.req("POST", `/api/reports/${rManual.id}/calibration`, {})).status === 404, "another organisation can't request reviews of this organisation's rounds");
  check((await otherAdmin.req("GET", `/app/calibration/${rManual.id}`)).status === 404, "another organisation can't open this organisation's blind reviews");
  check((await otherAdmin.req("POST", `/api/calibration/${rManual.id}`, { scores: { role_fit: 3 }, recommendation: "hire" })).status === 404, "another organisation can't submit reviews here");
  const otherStats = await otherAdmin.req("GET", "/app/calibration");
  check(!otherStats.text.includes(rManual.id) && otherStats.text.includes("No reviews in this period yet"), "another organisation sees none of this organisation's queue or statistics");

  /* ----------------------------- Accommodations ----------------------------- */
  const [drive] = await q<{ id: string }>("select id from drives where org_id = $1 and status = 'active' order by created_at desc limit 1", [orgId]);
  await admin.json("PUT", `/api/settings/users/${hm.id}`, { driveIds: [rReview.drive_id, rSample.drive_id, rManual.drive_id, drive.id] });
  const inv = await admin.json<{ results: { link: string }[] }>("POST", `/api/drives/${drive.id}/invites`, { candidates: [{ name: "Noor Adjust", email: `noor.${stamp}@example.com` }] });
  const token = inv.results[0].link.split("/c/")[1];
  const cand = new Client();
  check((await cand.req("POST", `/api/c/${token}/accommodation`, { extraTimePct: 50, extraBreaks: true })).status === 409, "adjustments can't be requested before consent");
  await cand.json("POST", `/api/c/${token}/consent`, { accept: true, webcam: true });
  check((await cand.req("POST", `/api/c/${token}/accommodation`, { extraTimePct: 30, extraBreaks: false })).status === 400, "only the offered amounts of extra time are accepted");
  check((await cand.req("POST", `/api/c/${token}/accommodation`, { extraTimePct: 0, extraBreaks: false, details: "  " })).status === 400, "an empty request is refused");
  const secret = "I have dyslexia and read slowly under time pressure.";
  check((await cand.req("POST", `/api/c/${token}/accommodation`, { extraTimePct: 50, extraBreaks: true, details: secret })).status === 201, "a candidate can ask for extra time and breaks");
  const hub = await cand.req("GET", `/c/${token}`);
  check(hub.text.includes("You asked for 50% extra time and extra breaks"), "the candidate sees their pending request");
  const [{ candidacy_id: cid }] = await q<{ candidacy_id: string }>("select candidacy_id from accommodations a join candidacies c on c.id = a.candidacy_id where c.access_token = $1", [token]);
  const auditRows = await q<{ data: unknown }>("select data from audit_log where action = 'accommodation.request' and entity_id = $1", [cid]);
  check(auditRows.length === 1 && !JSON.stringify(auditRows[0].data).includes("dyslexia"), "the audit log records the request without its private details");

  const decisions = await recruiter.client.req("GET", "/app/gate-queue");
  check(decisions.text.includes("Adjustment requests") && decisions.text.includes("Noor Adjust"), "recruiters see pending requests on the Decisions page");
  check((await recruiter.client.req("GET", `/app/candidates/${cid}`)).text.includes("dyslexia"), "recruiters see the request details");
  const hmView = await hm.client.req("GET", `/app/candidates/${cid}`);
  check(hmView.status === 200 && !hmView.text.includes("dyslexia") && !hmView.text.includes("Interview adjustments"), "hiring managers (decision makers) don't see adjustment requests");
  check(!(await hm.client.req("GET", "/app/gate-queue")).text.includes("Adjustment requests"), "hiring managers don't see the adjustment queue");
  check((await hm.client.req("POST", `/api/candidacies/${cid}/accommodation`, { approve: true })).status === 403, "hiring managers can't decide adjustment requests");
  check((await otherAdmin.req("POST", `/api/candidacies/${cid}/accommodation`, { approve: true })).status === 404, "another organisation can't decide this organisation's requests");
  check((await recruiter.client.req("POST", `/api/candidacies/${cid}/accommodation`, { approve: false })).status === 400, "declining needs a note to the candidate");
  await recruiter.client.json("POST", `/api/candidacies/${cid}/accommodation`, { approve: true, extraTimePct: 25, extraBreaks: true, note: "Approved — good luck!" });
  check((await cand.req("GET", `/c/${token}`)).text.includes("Approved: 25% extra time and extra breaks"), "the candidate sees the approved (adjusted) amount");

  // Skip onboarding (covered by the main smoke test) and open the round.
  await q("update candidacies set stage = 'ready', current_round_index = 0 where id = $1", [cid]);
  const lobby = await cand.req("GET", `/c/${token}/round/0`);
  check(lobby.text.includes("25% extra time") && lobby.text.includes("pause 4 times") && lobby.text.includes("10 minutes each"), "the round lobby shows the approved adjustments");
  const { sessionId } = await cand.json<{ sessionId: string }>("POST", `/api/c/${token}/rounds/0/start`, { mode: "text" });
  const [sess] = await q<{ started_at: Date; deadline_at: Date; state: { adjust?: { timeFactor: number; maxPauses: number }; sections: { minutes: number }[] } }>("select started_at, deadline_at, state from round_sessions where id = $1", [sessionId]);
  const [cfg] = await q<{ config: { rounds: { type: string; enabled: boolean; durationMin: number; sections: { enabled: boolean; minutes: number }[] }[] } }>("select v.config from candidacies c join drive_versions v on v.id = c.drive_version_id where c.id = $1", [cid]);
  const round0 = cfg.config.rounds.filter((r) => r.enabled)[0];
  const minutes = (sess.deadline_at.getTime() - sess.started_at.getTime()) / 60_000;
  check(Math.abs(minutes - round0.durationMin * 1.25) < 0.1, `the round clock is 25% longer (${minutes.toFixed(1)} min for a ${round0.durationMin}-min round)`);
  const firstSection = round0.sections.filter((s) => s.enabled)[0];
  check(sess.state.adjust?.timeFactor === 1.25 && Math.abs(sess.state.sections[0].minutes - firstSection.minutes * 1.25) < 0.11, "each section's time budget is stretched too");
  const base = `/api/c/${token}/sessions/${sessionId}`;
  const st = await cand.json<{ state: { pausesLeft: number } }>("GET", `${base}/state`);
  check(st.state.pausesLeft === 4, "four pauses are available instead of two");
  for (let i = 0; i < 3; i++) {
    await cand.json("POST", `${base}/control`, { action: "pause" });
    await cand.json("POST", `${base}/control`, { action: "resume" });
  }
  const after = await cand.json<{ state: { pausesLeft: number } }>("GET", `${base}/state`);
  check(after.state.pausesLeft === 1, "a third pause is allowed (it would be refused without the adjustment)");
  check((await admin.req("GET", `/app/candidates/${cid}`)).text.includes("adjusted timing"), "recruiters see that a round ran with adjusted timing");
  const exported = await cand.json<{ adjustmentRequest: { requested: { details: string }; status: string } }>("GET", `/api/c/${token}/data`);
  check(exported.adjustmentRequest?.requested.details === secret && exported.adjustmentRequest.status === "approved", "the candidate's data download includes their adjustment request");
  await cand.json("POST", `/api/c/${token}/accommodation`, { extraTimePct: 100, extraBreaks: true, details: secret });
  const [re] = await q<{ status: string }>("select status from accommodations where candidacy_id = $1", [cid]);
  check(re.status === "pending", "changing the request sends it back to the hiring team");

}

main().catch((e) => {
  console.error("\nPHASE 7 CHECKS FAILED:", e);
  process.exit(1);
});
