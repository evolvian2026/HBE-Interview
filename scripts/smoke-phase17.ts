/**
 * Phase 17 checks: quality of hire — hire records from offers (with the interview snapshot), joined / declined /
 * left, blind 90- and 180-day manager check-ins with inbox and reminders, the quality page, anonymised retention,
 * roles and organisation isolation. Runs against a dev server with AI_MOCK=true after `npm run smoke`.
 *   BASE_URL=http://localhost:3000 npx tsx scripts/smoke-phase17.ts
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
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

async function main() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const q: Q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const stamp = Date.now();
  // Many sign-ins from this machine in a short time (earlier suites) would trip the per-IP limit.
  await q("delete from rate_limits where key like 'login:ip:%'");
  const admin = await new Client().login(process.env.ADMIN_EMAIL!, process.env.ADMIN_PASSWORD!);
  const [{ org_id: orgId }] = await q<{ org_id: string }>("select org_id from users where email = $1", [process.env.ADMIN_EMAIL!.toLowerCase()]);
  try {
    await run(admin, orgId, q, stamp);
  } finally {
    await db.end();
  }
  console.log(`\nPHASE 17 CHECKS PASSED (${passed} checks)`);
}

async function run(admin: Client, orgId: string, q: Q, stamp: number) {
  const pw = "Lantern-Quarry-63";
  const mk = async (name: string, role: string, driveIds?: string[]) => {
    const email = `${name.toLowerCase().split(" ")[0]}.hire.${stamp}@hbe.local`;
    const { id } = await admin.json<{ id: string }>("POST", "/api/settings/users", { name, email, password: pw, role });
    if (driveIds) await admin.json("PUT", `/api/settings/users/${id}`, { driveIds });
    return { id, client: await new Client().login(email, pw) };
  };

  // Three finished candidacies with a ready combined report: we make offers to them.
  const done = await q<{ id: string; drive_id: string; name: string; final_score: number }>(
    `select c.id, c.drive_id, x.name, r.final_score from candidacies c join combined_reports r on r.candidacy_id = c.id and r.status = 'ready' join candidates x on x.id = c.candidate_id
      where c.org_id = $1 and c.stage = 'completed' and not exists (select 1 from hires h where h.candidacy_id = c.id) order by c.created_at desc limit 4`,
    [orgId],
  );
  if (done.length < 4) throw new Error("Need 4 completed candidates with a combined report — run `npm run smoke` a few times");
  const [h1, h2, h3, h4] = done;
  const manager = await mk("Mona Manager", "hiring_manager", [...new Set(done.map((d) => d.drive_id))]);
  const otherHm = await mk("Omar Other", "hiring_manager", [...new Set(done.map((d) => d.drive_id))]);
  const viewer = await mk("Vera Viewer", "viewer");
  const recruiter = await mk("Ravi Hires", "recruiter");

  /* -------------------------------- Offers -------------------------------- */
  for (const d of done) await admin.json("POST", `/api/candidacies/${d.id}/decision`, { decision: "offer", reason: "Strong interviews and a clear panel yes.", notifyCandidate: false });
  const hires = await q<{ id: string; candidacy_id: string; status: string; snapshot: { finalScore: number | null; aiRecommendation: string | null; roundScores: Record<string, number> }; role_title: string }>(
    "select id, candidacy_id, status, snapshot, role_title from hires where candidacy_id = any($1::uuid[])",
    [done.map((d) => d.id)],
  );
  check(hires.length === 4 && hires.every((h) => h.status === "offered"), "recording an offer creates a hire record");
  const hire = (cid: string) => hires.find((h) => h.candidacy_id === cid)!;
  check(hire(h1.id).snapshot.finalScore === h1.final_score && !!hire(h1.id).snapshot.aiRecommendation && Object.keys(hire(h1.id).snapshot.roundScores).length > 0, "the interview results at the time of the offer are frozen with it");
  const [legacy] = await q<{ id: string }>("select c.id from candidacies c left join hires h on h.candidacy_id = c.id where c.org_id = $1 and c.stage = 'offer' and h.id is null limit 1", [orgId]);
  const list = await recruiter.client.req("GET", "/app/hires");
  check(list.status === 200 && list.text.includes(h1.name) && list.text.includes("offer made"), "recruiters see hires");
  if (legacy) check((await q("select 1 from hires where candidacy_id = $1", [legacy.id])).length === 1, "offers made before this feature get a hire record too");
  check((await viewer.client.req("GET", "/app/hires")).status === 307, "viewers don't see hires");

  /* ----------------------------- Joined / declined ----------------------------- */
  const A = hire(h1.id).id;
  const B = hire(h2.id).id;
  const C = hire(h3.id).id;
  const D = hire(h4.id).id;
  check((await manager.client.req("POST", `/api/hires/${A}`, { action: "joined", joinedAt: daysAgo(100), managerId: manager.id })).status === 403, "only recruiters record joining");
  check((await recruiter.client.req("POST", `/api/hires/${A}`, { action: "joined", joinedAt: daysAgo(100), managerId: viewer.id })).status === 400, "a viewer can't be a hire's manager");
  check((await recruiter.client.req("POST", `/api/hires/${A}`, { action: "joined", joinedAt: new Date(Date.now() + 400 * 86_400_000).toISOString(), managerId: manager.id })).status === 400, "a joining date far in the future is refused");
  await recruiter.client.json("POST", `/api/hires/${A}`, { action: "joined", joinedAt: daysAgo(100), managerId: manager.id });
  await recruiter.client.json("POST", `/api/hires/${B}`, { action: "joined", joinedAt: daysAgo(200), managerId: manager.id });
  await recruiter.client.json("POST", `/api/hires/${C}`, { action: "declined" });
  await recruiter.client.json("POST", `/api/hires/${D}`, { action: "joined", joinedAt: daysAgo(10), managerId: manager.id });
  const reviews = await q<{ id: string; hire_id: string; checkpoint: number; due_at: Date; reviewer_id: string }>("select id, hire_id, checkpoint, due_at, reviewer_id from hire_reviews where hire_id = any($1::uuid[]) order by checkpoint", [[A, B, C, D]]);
  check(reviews.filter((r) => r.hire_id === A).map((r) => r.checkpoint).join() === "90,180" && reviews.every((r) => r.reviewer_id === manager.id), "joining schedules 90- and 180-day check-ins with the manager");
  check(!reviews.some((r) => r.hire_id === C), "a declined offer has no check-ins");
  check((await recruiter.client.req("POST", `/api/hires/${C}`, { action: "declined" })).status === 409, "a declined offer can't be declined again");

  /* -------------------------------- Check-ins -------------------------------- */
  const a90 = reviews.find((r) => r.hire_id === A && r.checkpoint === 90)!;
  const a180 = reviews.find((r) => r.hire_id === A && r.checkpoint === 180)!;
  const b90 = reviews.find((r) => r.hire_id === B && r.checkpoint === 90)!;
  const b180 = reviews.find((r) => r.hire_id === B && r.checkpoint === 180)!;
  const d90 = reviews.find((r) => r.hire_id === D && r.checkpoint === 90)!;
  const inbox = await manager.client.req("GET", "/app/inbox");
  check(inbox.text.includes("Check-ins on your new hires") && inbox.text.includes(`/app/hires/review/${a90.id}`), "the manager's inbox lists check-ins that are due");
  check(!inbox.text.includes(`/app/hires/review/${d90.id}`), "check-ins that aren't due yet stay out of the inbox");
  const form = await manager.client.req("GET", `/app/hires/review/${a90.id}`);
  check(form.status === 200 && form.text.includes("Shown after you submit") && !form.text.includes("Final interview score"), "the check-in form doesn't show the interview results");
  check((await otherHm.client.req("GET", `/app/hires/review/${a90.id}`)).status === 404, "only the hire's manager opens their check-in");
  check((await recruiter.client.req("POST", `/api/hires/reviews/${a90.id}`, { rating: 4, wouldRehire: "yes" })).status === 403, "other people can't give the manager's check-in");
  check((await manager.client.req("POST", `/api/hires/reviews/${a90.id}`, { rating: 6, wouldRehire: "yes" })).status === 400, "ratings are 1–5");
  check((await manager.client.req("POST", `/api/hires/reviews/${d90.id}`, { rating: 4, wouldRehire: "yes" })).status === 409, "a check-in can't be given long before it's due");
  await manager.client.json("POST", `/api/hires/reviews/${a90.id}`, { rating: 5, technical: 5, collaboration: 4, values: 5, wouldRehire: "yes", note: "Owns the billing service already." });
  await manager.client.json("POST", `/api/hires/reviews/${b90.id}`, { rating: 2, technical: 3, collaboration: 2, wouldRehire: "unsure" });
  await manager.client.json("POST", `/api/hires/reviews/${b180.id}`, { rating: 3, wouldRehire: "yes" });
  const after = await manager.client.req("GET", `/app/hires/review/${a90.id}`);
  check(after.text.includes("Final interview score") && after.text.includes("AI recommendation"), "after submitting, the manager sees what the interview said");
  const [saved] = await q<{ rating: number; submitted_at: Date; note: string }>("select rating, submitted_at, note from hire_reviews where id = $1", [a90.id]);
  check(saved.rating === 5 && saved.submitted_at && saved.note.includes("billing"), "the check-in is saved");
  check(!(await manager.client.req("GET", "/app/inbox")).text.includes(`/app/hires/review/${a90.id}`), "a submitted check-in leaves the inbox");

  /* -------------------------------- Reminders -------------------------------- */
  await q("update hire_reviews set reminded_at = null where id = $1", [a180.id]);
  await q("update hire_reviews set due_at = now() - interval '1 day' where id = $1", [a180.id]);
  const reminded = await waitFor("a reminder", async () => {
    const [r] = await q<{ reminded_at: Date | null }>("select reminded_at from hire_reviews where id = $1", [a180.id]);
    return r.reminded_at ? r : null;
  }, 90_000);
  check(!!reminded.reminded_at, "managers are reminded of overdue check-ins (at most weekly)");

  /* ---------------------------------- Leaving ---------------------------------- */
  await recruiter.client.json("POST", `/api/hires/${D}`, { action: "left", leftAt: daysAgo(2), reason: "resigned" });
  const dLeft = await q("select 1 from hire_reviews where hire_id = $1", [D]);
  check(dLeft.length === 0, "check-ins after someone leaves are cancelled");
  check((await recruiter.client.req("POST", `/api/hires/${D}`, { action: "left", leftAt: daysAgo(1), reason: "other" })).status === 409, "someone can only leave once");

  /* ------------------------------- Quality of hire ------------------------------- */
  const qp = await recruiter.client.req("GET", "/app/quality");
  check(qp.status === 200 && qp.text.includes("Which interview signals predict later ratings?") && qp.text.includes("Final interview score") && qp.text.includes("too early"), "the quality page relates interview signals to ratings (and says when it's too early)");
  check(qp.text.includes("Left within 90 days") && qp.text.includes("Would hire again"), "it shows rehire share and early attrition");
  check((await manager.client.req("GET", "/app/quality")).status === 307, "hiring managers don't see the organisation-wide quality page");

  /* --------------------------- Data deletion keeps stats --------------------------- */
  const exported = await new Client().json<{ hire?: { status: string } }>("GET", `/api/c/${(await q<{ access_token: string }>("select access_token from candidacies where id = $1", [h1.id]))[0].access_token}/data`);
  check(exported.hire?.status === "joined", "the person's data download includes their hire record");
  await admin.json("DELETE", `/api/candidacies/${h1.id}`);
  const [anon] = await q<{ candidacy_id: string | null }>("select candidacy_id from hires where id = $1", [A]);
  const [anonReview] = await q<{ note: string | null; rating: number }>("select note, rating from hire_reviews where id = $1", [a90.id]);
  check(anon.candidacy_id === null && anonReview.note === null && anonReview.rating === 5, "deleting the interview data keeps an anonymised hire record (no name, notes cleared, rating kept)");
  check((await recruiter.client.req("GET", "/app/hires")).text.includes("Former candidate"), "the hires list shows it without a name");

  /* --------------------------------- Isolation --------------------------------- */
  const otherEmail = `hire-iso.${stamp}@iso.test`;
  await admin.json("POST", "/api/platform/orgs", { name: `Hire Iso ${stamp}`, admin: { name: "Ina Admin", email: otherEmail, password: pw } });
  const other = await new Client().login(otherEmail, pw);
  check((await other.req("POST", `/api/hires/${B}`, { action: "declined" })).status === 404, "another organisation can't change these hires");
  check((await other.req("GET", `/app/hires/review/${b90.id}`)).status === 404, "another organisation can't open these check-ins");
  check(!(await other.req("GET", "/app/hires")).text.includes(h2.name), "another organisation sees none of these hires");
  const acts = (await q<{ action: string }>("select distinct action from audit_log where org_id = $1 and action like 'hire.%'", [orgId])).map((a) => a.action);
  check(["hire.joined", "hire.declined", "hire.left", "hire.review"].every((a) => acts.includes(a)), "hire updates and check-ins are audited");

  // Put the surviving test candidates back, so the script can run again on the same data.
  const keep = [h2.id, h3.id, h4.id];
  await q("delete from hires where candidacy_id = any($1::uuid[])", [keep]);
  await q("delete from hiring_decisions where candidacy_id = any($1::uuid[])", [keep]);
  await q("update candidacies set stage = 'completed', final_status = null where id = any($1::uuid[])", [keep]);
}

main().catch((e) => {
  console.error("\nPHASE 17 CHECKS FAILED:", e);
  process.exit(1);
});
