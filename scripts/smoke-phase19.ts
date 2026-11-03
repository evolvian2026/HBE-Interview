/**
 * Phase 19 checks: screening tests — question bank (form, CSV import, retire), drive setting validated at publish,
 * the candidate test (paper without answers, autosave, focus, submit), pass, review and automatic rejection, time
 * limits, results by college and CSV, data download without the answer key, roles and isolation.
 * Runs against a dev server with AI_MOCK=true; creates and closes its own drive.
 *   BASE_URL=http://localhost:3000 npx tsx scripts/smoke-phase19.ts
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
const JD = "We are hiring graduate software engineers for our campus programme. You will build and test backend services in Python or Java, write SQL, work with Git, and learn from senior engineers. We value problem solving, clear communication and curiosity. Strong fundamentals in data structures, algorithms and databases are expected.";

async function main() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const q: Q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const stamp = Date.now();
  await q("delete from rate_limits where key like 'login:ip:%'");
  const admin = await new Client().login(process.env.ADMIN_EMAIL!, process.env.ADMIN_PASSWORD!);
  const [{ org_id: orgId }] = await q<{ org_id: string }>("select org_id from users where email = $1", [process.env.ADMIN_EMAIL!.toLowerCase()]);
  const drives: string[] = [];
  try {
    await run(admin, orgId, q, stamp, drives);
  } finally {
    // Close the test drive so other scripts (which use the latest active drive) aren't affected.
    for (const d of drives) await admin.req("POST", `/api/drives/${d}/status`, { status: "closed" });
    await db.end();
  }
  console.log(`\nPHASE 19 CHECKS PASSED (${passed} checks)`);
}

async function run(admin: Client, orgId: string, q: Q, stamp: number, drives: string[]) {
  const pw = "Lantern-Quarry-63";
  const mk = async (name: string, role: string) => {
    const email = `${name.toLowerCase().split(" ")[0]}.apt.${stamp}@hbe.local`;
    await admin.json("POST", "/api/settings/users", { name, email, password: pw, role });
    return new Client().login(email, pw);
  };
  const recruiter = await mk("Rohan Campus", "recruiter");
  const hm = await mk("Hina Campus", "hiring_manager");

  /* ------------------------------ Question bank ------------------------------ */
  check((await recruiter.req("POST", "/api/question-bank", { section: "quant", stem: "What is 3 + 4?", options: ["7", "7", "8", "9"], answer: 0 })).status === 400, "questions need four different options");
  check((await hm.req("POST", "/api/question-bank", { section: "quant", stem: "What is 3 + 4?", options: ["6", "7", "8", "9"], answer: 1 })).status === 403, "hiring managers don't edit the question bank");
  const added = await recruiter.json<{ id: string }>("POST", "/api/question-bank", { section: "quant", difficulty: "easy", stem: `What is 3 + 4? (${stamp})`, options: ["6", "7", "8", "9"], answer: 1 });
  const csv = `section,difficulty,question,a,b,c,d,answer,explanation\nlogical,easy,"Next: 2, 4, 8, ? (${stamp})",10,12,16,18,C,Doubles\nverbal,medium,Opposite of HOT (${stamp}),Warm,Cold,Boiling,Mild,B,\nhistory,easy,Who? (${stamp}),a,b,c,d,A,\n`;
  const imp = await recruiter.json<{ added: number; problems: string[] }>("POST", "/api/question-bank/import", { csv });
  check(imp.added === 2 && imp.problems.length === 1 && imp.problems[0].includes("Row 4"), "questions import from CSV, with problems reported per row");
  const bankPage = await recruiter.req("GET", "/app/question-bank");
  check(bankPage.text.includes("Question bank") && bankPage.text.includes(`What is 3 + 4? (${stamp})`), "the question bank lists the organisation's own questions");
  await recruiter.json("PATCH", `/api/question-bank/${added.id}`, { active: false });
  const [retired] = await q<{ active: boolean }>("select active from aptitude_questions where id = $1", [added.id]);
  check(retired.active === false, "questions can be retired from future tests");

  /* ------------------------------- Drive setup ------------------------------- */
  const d = await admin.json<{ id: string }>("POST", "/api/drives", { title: `Campus Engineer ${stamp}`, jdText: JD });
  drives.push(d.id);
  const [{ draft }] = await q<{ draft: Record<string, unknown> }>("select draft from drives where id = $1", [d.id]);
  const screening = { enabled: true, sections: { quant: 2, logical: 2, verbal: 1, technical: 1 }, durationMin: 10, passMark: 50, onFail: "review", showScore: false };
  await admin.json("PUT", `/api/drives/${d.id}`, { config: { ...draft, screening: { ...screening, sections: { ...screening.sections, quant: 25 } } } });
  const tooMany = await admin.req("POST", `/api/drives/${d.id}/publish`, {});
  check(tooMany.status === 400 && /Only \d+ quant/.test(tooMany.text), "a test needing more questions than the bank has can't be published");
  await admin.json("PUT", `/api/drives/${d.id}`, { config: { ...draft, screening } });
  const [saved] = await q<{ draft: { screening?: { enabled: boolean } } }>("select draft from drives where id = $1", [d.id]);
  check(saved.draft.screening?.enabled === true, "the screening test is saved with the drive");
  await admin.json("POST", `/api/drives/${d.id}/publish`, {});
  check((await admin.req("GET", `/app/drives/${d.id}`)).text.includes("Test results"), "the drive links to its test results");

  const invite = async (name: string, college?: string) => {
    const r = await recruiter.json<{ results: { link: string }[] }>("POST", `/api/drives/${d.id}/invites`, { candidates: [{ name, email: `${name.toLowerCase().replace(/ /g, ".")}.${stamp}@example.com`, college }] });
    const token = r.results[0].link.split("/c/")[1];
    const [{ id }] = await q<{ id: string }>("select id from candidacies where access_token = $1", [token]);
    const c = new Client();
    await c.json("POST", `/api/c/${token}/consent`, { accept: true });
    return { token, id, c };
  };
  const paperOf = async (cid: string) => (await q<{ paper: { qid: string; correct: number; options: string[] }[] }>("select paper from screening_attempts where candidacy_id = $1", [cid]))[0].paper;
  const answerAll = async (x: { token: string; c: Client; id: string }, right: boolean) => {
    for (const p of await paperOf(x.id)) await x.c.json("PUT", `/api/c/${x.token}/screening/answer`, { qid: p.qid, choice: right ? p.correct : (p.correct + 1) % p.options.length });
  };

  /* ------------------------------- Candidate A ------------------------------- */
  const A = await invite("Anika Topper", "IIT Delhi");
  const [ac] = await q<{ college: string; stage: string }>("select college, stage from candidacies where id = $1", [A.id]);
  check(ac.college === "IIT Delhi" && ac.stage === "onboarding", "invites record the college; consent leads to the test");
  const hub = await A.c.req("GET", `/c/${A.token}`);
  check(hub.text.includes("Next: a short screening test") && hub.text.includes("6 multiple-choice questions in 10 minutes"), "the candidate is asked to take the test first");
  const form = new FormData();
  form.append("file", new Blob(["%PDF-1.4 test"], { type: "application/pdf" }), "cv.pdf");
  const early = await fetch(`${BASE}/api/c/${A.token}/resume`, { method: "POST", body: form, headers: { origin: BASE } });
  check(early.status === 409, "the resume step can't be skipped ahead of the test");
  const st0 = await A.c.json<{ status: string; paper: unknown }>("GET", `/api/c/${A.token}/screening`);
  check(st0.status === "todo" && st0.paper === null, "before starting, no questions are shown");
  const paperRes = await A.c.req("POST", `/api/c/${A.token}/screening/start`, {});
  const pub = JSON.parse(paperRes.text) as { questions: { qid: string; options: string[] }[]; deadlineAt: string };
  check(pub.questions.length === 6 && !/"correct"|"answer"\s*:/.test(paperRes.text), "the paper has the configured questions and never includes the answers");
  const mins = (Date.parse(pub.deadlineAt) - Date.now()) / 60_000;
  check(mins > 9 && mins <= 10.1, "the clock is set from the drive's time limit");
  const again = await A.c.json<{ questions: { qid: string }[] }>("POST", `/api/c/${A.token}/screening/start`, {});
  check(again.questions.map((x) => x.qid).join() === pub.questions.map((x) => x.qid).join(), "starting again resumes the same paper");
  check((await A.c.req("PUT", `/api/c/${A.token}/screening/answer`, { qid: pub.questions[0].qid, choice: 7 })).status === 400, "only listed options can be chosen");
  check((await A.c.req("PUT", `/api/c/${A.token}/screening/answer`, { qid: "nope", choice: 0 })).status === 400, "only questions on the paper can be answered");
  await A.c.json("POST", `/api/c/${A.token}/screening/focus`, { count: 3 });
  await answerAll(A, true);
  const subA = await A.c.json<{ status: string; score: unknown }>("POST", `/api/c/${A.token}/screening/submit`, {});
  check(subA.status === "passed" && subA.score === null, "a full-marks paper passes (and the score isn't shown when the drive says so)");
  const [aa] = await q<{ percent: number; focus_losses: number; passed: boolean }>("select percent, focus_losses, passed from screening_attempts where candidacy_id = $1", [A.id]);
  check(aa.percent === 100 && aa.passed && aa.focus_losses === 3, "the score and the tab-leave count are recorded");
  check(!(await A.c.req("GET", `/c/${A.token}`)).text.includes("screening test") || (await A.c.req("GET", `/c/${A.token}`)).text.includes("Test ✓"), "after passing, the candidate moves on to their resume");
  check((await A.c.req("PUT", `/api/c/${A.token}/screening/answer`, { qid: pub.questions[0].qid, choice: 0 })).status === 409, "a submitted test can't be changed");

  /* --------------------------- Below the pass mark --------------------------- */
  const B = await invite("Bharat Review", "NIT Trichy");
  await B.c.json("POST", `/api/c/${B.token}/screening/start`, {});
  await answerAll(B, false);
  const subB = await B.c.json<{ status: string }>("POST", `/api/c/${B.token}/screening/submit`, {});
  check(subB.status === "review", "below the pass mark on a review drive, the result waits for a recruiter");
  check((await B.c.req("GET", `/c/${B.token}`)).text.includes("the hiring team is reviewing your result"), "the candidate is told their result is being reviewed");
  check((await recruiter.req("GET", "/app/inbox")).text.includes("Screening tests below the pass mark"), "recruiters see results waiting for a decision in their inbox");
  check((await admin.req("GET", `/app/candidates/${B.id}`)).text.includes("Below the pass mark — your decision"), "the candidate report shows the result and asks for a decision");
  check((await hm.req("POST", `/api/candidacies/${B.id}/screening`, { decision: "pass" })).status === 403, "hiring managers can't decide test results");
  await recruiter.json("POST", `/api/candidacies/${B.id}/screening`, { decision: "pass", note: "Strong coding test elsewhere" });
  const [bb] = await q<{ passed: boolean; review_status: string }>("select passed, review_status from screening_attempts where candidacy_id = $1", [B.id]);
  check(bb.passed && bb.review_status === "passed" && !(await B.c.req("GET", `/c/${B.token}`)).text.includes("reviewing your result"), "a recruiter can let the candidate continue");
  const D = await invite("Divya Decline", "NIT Trichy");
  await D.c.json("POST", `/api/c/${D.token}/screening/start`, {});
  await answerAll(D, false);
  await D.c.json("POST", `/api/c/${D.token}/screening/submit`, {});
  await recruiter.json("POST", `/api/candidacies/${D.id}/screening`, { decision: "fail" });
  const [dd] = await q<{ stage: string }>("select stage from candidacies where id = $1", [D.id]);
  check(dd.stage === "rejected", "or not continue (the candidate is rejected and told)");
  check((await recruiter.req("POST", `/api/candidacies/${D.id}/screening`, { decision: "pass" })).status === 409, "a decided result can't be decided again");

  /* --------------------------- Automatic rejection --------------------------- */
  await admin.json("PUT", `/api/drives/${d.id}`, { config: { ...draft, screening: { ...screening, onFail: "reject", showScore: true } } });
  await admin.json("POST", `/api/drives/${d.id}/publish`, {});
  const C = await invite("Chetan Auto", "IIT Delhi");
  await C.c.json("POST", `/api/c/${C.token}/screening/start`, {});
  await answerAll(C, false);
  const subC = await C.c.json<{ status: string; score: { percent: number } | null }>("POST", `/api/c/${C.token}/screening/submit`, {});
  const [cc] = await q<{ stage: string }>("select stage from candidacies where id = $1", [C.id]);
  check(subC.score?.percent === 0 && cc.stage === "rejected", "on a reject drive, a fail rejects automatically (and the score is shown when allowed)");

  /* ------------------------------ Running out of time ------------------------------ */
  const E = await invite("Esha Late");
  await E.c.json("POST", `/api/c/${E.token}/screening/start`, {});
  const ep = await paperOf(E.id);
  await E.c.json("PUT", `/api/c/${E.token}/screening/answer`, { qid: ep[0].qid, choice: ep[0].correct });
  await q("update screening_attempts set deadline_at = now() - interval '1 minute' where candidacy_id = $1", [E.id]);
  check((await E.c.req("PUT", `/api/c/${E.token}/screening/answer`, { qid: ep[1].qid, choice: 0 })).status === 409, "answers after the time limit are refused");
  const [ee] = await q<{ submit_reason: string; percent: number }>("select submit_reason, percent from screening_attempts where candidacy_id = $1", [E.id]);
  check(ee.submit_reason === "time_up" && Math.abs(ee.percent - 100 / 6) < 0.2, "the answers given before time ran out are submitted");
  const F = await invite("Farhan Away");
  await F.c.json("POST", `/api/c/${F.token}/screening/start`, {});
  await q("update screening_attempts set deadline_at = now() - interval '3 minutes' where candidacy_id = $1", [F.id]);
  const closed = await waitFor("an abandoned test to be closed", async () => {
    const [r] = await q<{ submitted_at: Date | null; submit_reason: string | null }>("select submitted_at, submit_reason from screening_attempts where candidacy_id = $1", [F.id]);
    return r.submitted_at ? r : null;
  }, 90_000);
  check(closed.submit_reason === "time_up", "abandoned tests are closed automatically when time runs out");

  /* ------------------------------ Results and data ------------------------------ */
  const res = await recruiter.req("GET", `/app/drives/${d.id}/screening`);
  check(res.status === 200 && res.text.includes("Screening test results") && res.text.includes("IIT Delhi") && res.text.includes("NIT Trichy") && res.text.includes("By college"), "drive results show scores, sections and a breakdown by college");
  const exp = await recruiter.req("GET", `/api/drives/${d.id}/screening/export`);
  check(exp.type.includes("text/csv") && exp.text.startsWith("name,email,college,percent,result") && exp.text.includes("IIT Delhi"), "results export as CSV");
  const data = await A.c.json<{ screeningTest: { percent: number; answers: { yourAnswer: string | null }[] } }>("GET", `/api/c/${A.token}/data`);
  check(data.screeningTest.percent === 100 && data.screeningTest.answers.length === 6 && data.screeningTest.answers.every((x) => Object.keys(x).sort().join() === "question,section,yourAnswer") && !/"options"|"stem"|"paper"/.test(JSON.stringify(data.screeningTest)), "the candidate's data download has their score and answers, not the answer key");

  /* -------------------------------- Isolation -------------------------------- */
  const otherEmail = `apt-iso.${stamp}@iso.test`;
  await admin.json("POST", "/api/platform/orgs", { name: `Apt Iso ${stamp}`, admin: { name: "Ira Admin", email: otherEmail, password: pw } });
  const oth = await new Client().login(otherEmail, pw);
  check((await oth.req("GET", `/app/drives/${d.id}/screening`)).status === 404, "another organisation can't see these results");
  check((await oth.req("POST", `/api/candidacies/${B.id}/screening`, { decision: "fail" })).status === 404, "another organisation can't decide these results");
  check((await oth.req("PATCH", `/api/question-bank/${added.id}`, { active: true })).status === 404, "another organisation can't change this organisation's questions");
  check(!(await oth.req("GET", "/app/question-bank")).text.includes(`(${stamp})`), "another organisation doesn't see this organisation's questions");
  const acts = (await q<{ action: string }>("select distinct action from audit_log where org_id = $1 and action like 'screening.%'", [orgId])).map((a) => a.action);
  check(["screening.start", "screening.submit", "screening.review_pass", "screening.review_fail", "screening.question_add", "screening.export"].every((a) => acts.includes(a)), "tests, decisions, questions and exports are audited");
}

main().catch((e) => {
  console.error("\nPHASE 19 CHECKS FAILED:", e);
  process.exit(1);
});
