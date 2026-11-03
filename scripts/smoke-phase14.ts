/**
 * Phase 14 checks: the scoring test bench — cases from real rounds (anonymised, deleted with the candidate), from blind
 * reviews and written by hand; runs through the live scoring pipeline with repeats; verdict, big misses, baseline
 * comparison, CSV, deletion, settings, admin-only access and organisation isolation.
 * Runs against a dev server with AI_MOCK=true, after the earlier smoke tests (it uses their evaluated rounds).
 *   BASE_URL=http://localhost:3000 npx tsx scripts/smoke-phase14.ts
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
    await admin.json("PUT", "/api/settings", { testBenchMonthly: false });
    await db.end();
  }
  console.log(`\nPHASE 14 CHECKS PASSED (${passed} checks)`);
}

async function waitRun(q: Q, id: string) {
  return waitFor(`run ${id}`, async () => {
    const [r] = await q<{ status: string; summary: Record<string, unknown> | null; is_baseline: boolean }>("select status, summary, is_baseline from benchmark_runs where id = $1", [id]);
    return r.status !== "running" ? r : null;
  });
}

async function run(admin: Client, orgId: string, q: Q, stamp: number) {
  // Start from an empty bench in this organisation (dev data only).
  await q("delete from benchmark_runs where org_id = $1", [orgId]);
  await q("delete from benchmark_cases where org_id = $1", [orgId]);
  await q("delete from rate_limits where key like 'bench-run:%'");

  const pw = "Lantern-Quarry-63";
  const recEmail = `rita.bench.${stamp}@hbe.local`;
  await admin.json("POST", "/api/settings/users", { name: "Rita Bench", email: recEmail, password: pw, role: "recruiter" });
  const recruiter = await new Client().login(recEmail, pw);

  /* ------------------------------- Access ------------------------------- */
  check((await recruiter.req("GET", "/app/test-bench")).status === 307, "the test bench is for admins only (page)");
  const [report] = await q<{ id: string; candidacy_id: string; name: string; email: string }>(
    `select r.id, r.candidacy_id, x.name, x.email from round_reports r join candidacies c on c.id = r.candidacy_id join candidates x on x.id = c.candidate_id
     where c.org_id = $1 and r.status = 'ready' and r.round_type = 'technical' and not exists (select 1 from calibration_reviews v where v.report_id = r.id)
       and (select count(*) from messages m where m.session_id = r.session_id and m.role = 'candidate') >= 3
     order by r.updated_at desc limit 1`,
    [orgId],
  );
  check((await recruiter.req("POST", "/api/test-bench/cases", { reportId: report.id })).status === 403, "recruiters can't add test cases");

  /* ------------------------------ Real rounds ------------------------------ */
  const added = await admin.json<{ id: string }>("POST", "/api/test-bench/cases", { reportId: report.id });
  check((await admin.req("POST", "/api/test-bench/cases", { reportId: report.id })).status === 409, "the same round can't be added twice");
  const [c1] = await q<{ candidacy_id: string; expected_source: string; bundle: { transcriptText: string }; title: string; original: { recommendation: string } }>("select candidacy_id, expected_source, bundle, title, original from benchmark_cases where id = $1", [added.id]);
  check(c1.candidacy_id === report.candidacy_id && c1.original?.recommendation, "a case freezes a real round with the AI's original result");
  check(c1.expected_source === "ai" || c1.expected_source === "override", "without a blind review, expected scores start from the AI's (to be confirmed)");
  const raw = JSON.stringify(c1);
  const nameParts = report.name.split(/\s+/).filter((t) => t.length >= 3);
  check(c1.bundle.transcriptText.length > 50 && !nameParts.some((t) => new RegExp(`\\b${t}\\b`, "i").test(raw)) && !raw.toLowerCase().includes(report.email.toLowerCase()), "the frozen case is anonymised (no name or email)");
  check(!c1.title.includes(nameParts[0] ?? "§"), "case titles don't name the candidate");
  const cand = await admin.req("GET", `/app/candidates/${report.candidacy_id}`);
  check(cand.text.includes("In the test bench"), "the candidate report shows the round is in the test bench");

  const fromCal = await admin.json<{ added: number }>("POST", "/api/test-bench/cases", { fromCalibration: true });
  const calCases = await q<{ id: string }>("select id from benchmark_cases where org_id = $1 and expected_source = 'calibration'", [orgId]);
  check(fromCal.added > 0 && calCases.length === fromCal.added, `blind-reviewed rounds are added with the reviewers' scores as expected (${fromCal.added})`);
  check((await admin.json<{ added: number }>("POST", "/api/test-bench/cases", { fromCalibration: true })).added === 0, "adding reviewed rounds again adds nothing new");
  const [fk] = await q<{ delete_rule: string }>(
    "select rc.delete_rule from information_schema.referential_constraints rc where rc.constraint_name = 'benchmark_cases_candidacy_id_candidacies_id_fk'",
  );
  check(fk?.delete_rule === "CASCADE", "cases from real rounds are deleted with the candidate's data");

  /* ------------------------------ Written cases ------------------------------ */
  const [drive] = await q<{ id: string }>(
    "select d.id from drives d join drive_versions v on v.drive_id = d.id where d.org_id = $1 and d.status = 'active' and v.config::text like '%\"type\": \"technical\"%' order by d.created_at desc limit 1",
    [orgId],
  ).then(async (rows) => (rows.length ? rows : q<{ id: string }>("select id from drives where org_id = $1 and status = 'active' order by created_at desc limit 1", [orgId])));
  check((await admin.req("POST", "/api/test-bench/cases/written", { title: "Bad", driveId: drive.id, roundType: "technical", transcript: "no speaker labels in this text at all", expected: { params: { role_fit: 3 }, recommendation: "hire" } })).status === 400, "a written case needs speaker labels");
  const transcript = `Interviewer: Tell me about a recent backend problem you solved.
Candidate: Our checkout API slowed down at peak traffic. I profiled it, found an N+1 query in the order history call, batched it into one query and added a composite index. p95 latency went from 2.1 seconds to 380 milliseconds and we added an alert on it.
Interviewer: How did you make sure the fix was safe?
Candidate: I wrote a regression test that counts queries per request, ran it in CI, and rolled out behind a flag to ten percent of traffic first while watching error rates.
Interviewer: What would you do differently?
Candidate: I would add query-count checks earlier so this kind of problem is caught in review rather than in production.`;
  const strong = await admin.json<{ id: string }>("POST", "/api/test-bench/cases/written", {
    title: "Written: clear ownership, measured result",
    driveId: drive.id,
    roundType: "technical",
    transcript,
    expected: { params: { role_fit: 5, problem_solving: 5, communication: 5 }, recommendation: "strong_hire" },
    notes: "Specific, measured, owns the work.",
  });
  const [w] = await q<{ candidacy_id: string | null; expected_source: string; expected: { params: Record<string, number | null> } }>("select candidacy_id, expected_source, expected from benchmark_cases where id = $1", [strong.id]);
  check(w.candidacy_id === null && w.expected_source === "manual", "a written case holds no candidate data and keeps the team's scores");
  check((await admin.req("PUT", `/api/test-bench/cases/${strong.id}`, { expected: { params: { role_fit: 9 }, recommendation: "hire" } })).status === 400, "expected scores must be 1–5");
  check((await admin.req("PUT", `/api/test-bench/cases/${strong.id}`, { expected: { params: { not_a_param: 3 }, recommendation: "hire" } })).status === 400, "expected scores must be for the round's parameters");

  // Make the real-round case's expectation match what the AI said, so it should pass.
  const [orig] = await q<{ original: { params: Record<string, number | null>; recommendation: string } }>("select original from benchmark_cases where id = $1", [added.id]);
  await admin.json("PUT", `/api/test-bench/cases/${added.id}`, { expected: orig.original, notes: "Confirmed by the hiring team." });
  const [after] = await q<{ expected_source: string }>("select expected_source from benchmark_cases where id = $1", [added.id]);
  check(after.expected_source === "manual", "confirming expected scores records them as the team's");

  /* ---------------------------------- Runs ---------------------------------- */
  check((await recruiter.req("POST", "/api/test-bench/runs", {})).status === 403, "recruiters can't start runs");
  check((await admin.req("POST", "/api/test-bench/runs", { model: "claude-opus-5-5" })).status === 400, "trying another model needs real AI (refused in mock mode)");
  const activeCases = (await q<{ n: number }>("select count(*)::int n from benchmark_cases where org_id = $1 and active", [orgId]))[0].n;
  const r1 = await admin.json<{ id: string }>("POST", "/api/test-bench/runs", { label: `Smoke ${stamp}`, repeats: 2 });
  check((await admin.req("POST", "/api/test-bench/runs", {})).status === 409, "only one run at a time");
  const run1 = await waitRun(q, r1.id);
  const res1 = await q<{ status: string; params: Record<string, number | null> | null; recommendation: string | null; case_id: string }>("select status, params, recommendation, case_id from benchmark_results where run_id = $1", [r1.id]);
  check(res1.length === activeCases * 2 && res1.every((r) => r.status === "done" && r.params && r.recommendation), `every case is scored twice through the live pipeline (${res1.length} scorings)`);
  check(run1.status === "completed" && run1.is_baseline, "the first completed run becomes the baseline");
  const s1 = run1.summary as { verdict: string; cases: number; repeats: number; outcomes: { caseId: string; bigMiss: boolean; unstable: boolean }[]; overall: { mae: number | null } };
  check(["pass", "review", "fail"].includes(s1.verdict) && s1.cases === activeCases && s1.repeats === 2, `the run has a verdict (${s1.verdict}, average difference ${s1.overall.mae?.toFixed(2)})`);
  check(s1.outcomes.find((o) => o.caseId === strong.id)?.bigMiss === true, "a case the AI scores far from the team's is flagged as a big miss");
  check(s1.outcomes.find((o) => o.caseId === added.id)?.bigMiss === false, "a case the AI scores like the team is not flagged");
  check(s1.outcomes.every((o) => !o.unstable), "mock scoring is consistent across repeats");
  const live = await q<{ n: number }>("select count(*)::int n from round_reports where id = $1 and updated_at > now() - interval '1 minute'", [report.id]);
  check(live[0].n === 0, "running the bench never changes a candidate's report");

  const page = await admin.req("GET", `/app/test-bench/runs/${r1.id}`);
  check(page.status === 200 && page.text.includes("big miss") && page.text.includes("Average difference") && page.text.includes("Written: clear ownership"), "the run page shows the verdict, metrics and flagged cases");
  const list = await admin.req("GET", "/app/test-bench");
  check(list.text.includes("Scoring test bench") && list.text.includes(`Smoke ${stamp}`) && list.text.includes("baseline"), "the test bench page lists cases and runs");
  const casePage = await admin.req("GET", `/app/test-bench/cases/${added.id}`);
  check(casePage.status === 200 && casePage.text.includes("What the evaluator reads") && casePage.text.includes(`Smoke ${stamp}`), "a case page shows what the evaluator reads and its past results");
  const csv = await admin.req("GET", `/api/test-bench/runs/${r1.id}/export`);
  check(csv.type.includes("text/csv") && csv.text.startsWith("case,repeat,status,expected_recommendation") && csv.text.split("\n").length >= activeCases * 2 + 1, "a run exports as CSV");

  /* ---------------------- A second run, compared with the baseline ---------------------- */
  await admin.json("PUT", `/api/test-bench/cases/${strong.id}`, { active: false });
  const r2 = await admin.json<{ id: string }>("POST", "/api/test-bench/runs", { label: `Smoke B ${stamp}` });
  const run2 = await waitRun(q, r2.id);
  const s2 = run2.summary as { cases: number; comparedWith: { runId: string; baseline: boolean } | null; comparison: { cases: number; meanShift: number | null } | null };
  check(s2.cases === activeCases - 1, "cases left out of runs are skipped");
  check(s2.comparedWith?.runId === r1.id && s2.comparedWith.baseline && s2.comparison && s2.comparison.cases === activeCases - 1 && s2.comparison.meanShift === 0, "a run is compared with the baseline, case by case");
  check((await admin.req("GET", `/app/test-bench/runs/${r2.id}`)).text.includes("Compared with the baseline"), "the comparison is shown on the run page");
  await admin.json("POST", `/api/test-bench/runs/${r2.id}`, { action: "baseline" });
  const bases = await q<{ id: string }>("select id from benchmark_runs where org_id = $1 and is_baseline", [orgId]);
  check(bases.length === 1 && bases[0].id === r2.id, "an admin can move the baseline to another run");
  check((await admin.req("POST", `/api/test-bench/runs/${r2.id}`, { action: "cancel" })).status === 409, "a finished run can't be cancelled");

  const r3 = await admin.json<{ id: string }>("POST", "/api/test-bench/runs", {});
  const cancel = await admin.req("POST", `/api/test-bench/runs/${r3.id}`, { action: "cancel" });
  const [run3] = await q<{ status: string }>("select status from benchmark_runs where id = $1", [r3.id]);
  check((cancel.status === 200 && run3.status === "cancelled") || (cancel.status === 409 && run3.status === "completed"), `a run in progress can be cancelled (${run3.status})`);

  /* ------------------------------ Deleting a case ------------------------------ */
  await admin.json("DELETE", `/api/test-bench/cases/${strong.id}`);
  const kept = await q<{ case_id: string | null; case_title: string }>("select case_id, case_title from benchmark_results where run_id = $1 and case_title like 'Written:%'", [r1.id]);
  check(kept.length === 2 && kept.every((k) => k.case_id === null), "deleting a case keeps past runs' numbers");
  check((await admin.req("GET", `/app/test-bench/runs/${r1.id}`)).text.includes("(deleted)"), "deleted cases are marked in past runs");

  /* -------------------------------- Settings -------------------------------- */
  const st = await admin.json<{ testBenchMonthly: boolean }>("PUT", "/api/settings", { testBenchMonthly: true });
  check(st.testBenchMonthly === true, "admins can turn on monthly automatic runs");

  /* -------------------------------- Isolation -------------------------------- */
  const otherAdminEmail = `bench-iso.${stamp}@iso.test`;
  await admin.json("POST", "/api/platform/orgs", { name: `Bench Isolation ${stamp}`, admin: { name: "Ina Admin", email: otherAdminEmail, password: pw } });
  const other = await new Client().login(otherAdminEmail, pw);
  check((await other.req("GET", `/app/test-bench/runs/${r1.id}`)).status === 404, "another organisation can't open this organisation's runs");
  check((await other.req("GET", `/app/test-bench/cases/${added.id}`)).status === 404, "another organisation can't open this organisation's cases");
  check((await other.req("PUT", `/api/test-bench/cases/${added.id}`, { active: false })).status === 404, "another organisation can't change this organisation's cases");
  check((await other.req("POST", "/api/test-bench/cases", { reportId: report.id })).status === 404, "another organisation can't add this organisation's rounds");
  check((await other.req("GET", `/api/test-bench/runs/${r1.id}/export`)).status === 404, "another organisation can't export this organisation's runs");
  check((await other.req("POST", `/api/test-bench/runs/${r1.id}`, { action: "baseline" })).status === 404, "another organisation can't move this organisation's baseline");
  check(!(await other.req("GET", "/app/test-bench")).text.includes(`Smoke ${stamp}`), "another organisation's test bench is empty");
  const audits = await q<{ action: string }>("select distinct action from audit_log where org_id = $1 and action like 'benchmark.%'", [orgId]);
  const acts = audits.map((a) => a.action);
  check(["benchmark.case_add", "benchmark.case_write", "benchmark.run_start", "benchmark.run_complete", "benchmark.baseline", "benchmark.case_delete"].every((a) => acts.includes(a)), "test bench actions are audited");
}

main().catch((e) => {
  console.error("\nPHASE 14 CHECKS FAILED:", e);
  process.exit(1);
});
