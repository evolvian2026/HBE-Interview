/**
 * Phase 9 checks: candidacy sources, talent-pool consent, search, tags, profile, re-invite with resume reuse, leaving
 * the pool, hiring insights and CSV, roles and isolation. Uses candidates from the earlier smoke tests.
 *   BASE_URL=http://localhost:3000 npx tsx scripts/smoke-phase9.ts
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

const JD = `We are hiring a Platform Engineer to build and run our Kubernetes-based developer platform. You will own CI/CD pipelines, observability with Prometheus and Grafana, infrastructure as code with Terraform on AWS, and help product teams ship safely. Requirements: 4+ years of infrastructure or backend experience, strong Linux and networking fundamentals, scripting in Python or Go, and on-call experience.`;

async function main() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const q = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows as T[];
  const stamp = Date.now();
  const admin = await new Client().login(process.env.ADMIN_EMAIL!, process.env.ADMIN_PASSWORD!);
  const [{ org_id: orgId }] = await q<{ org_id: string }>("select org_id from users where email = $1", [process.env.ADMIN_EMAIL!.toLowerCase()]);

  // A person who finished the AI rounds and has a parsed resume.
  const [c] = await q<{ id: string; drive_id: string; access_token: string; candidate_id: string; name: string; email: string }>(
    `select c.id, c.drive_id, c.access_token, c.candidate_id, cand.name, cand.email from candidacies c
       join candidates cand on cand.id = c.candidate_id join combined_reports r on r.candidacy_id = c.id and r.status = 'ready'
       join resumes res on res.candidacy_id = c.id and res.raw_text is not null
      where c.org_id = $1 order by c.created_at desc limit 1`,
    [orgId],
  );
  if (!c) throw new Error("Run `npm run smoke` first");
  await q("update candidates set pool_consent_at = null, pool_expires_at = null, tags = '[]' where id = $1", [c.candidate_id]);

  const pw = "Saffron-Lighthouse-29";
  const mk = async (name: string, role: string, driveIds?: string[]) => {
    const email = `${name.toLowerCase().replace(/\s/g, ".")}.${stamp}@talent.test`;
    const { id } = await admin.json<{ id: string }>("POST", "/api/settings/users", { name, email, password: pw, role });
    if (driveIds) await admin.json("PUT", `/api/settings/users/${id}`, { driveIds });
    return { id, client: await new Client().login(email, pw) };
  };
  const recruiter = (await mk("Tara Talent", "recruiter")).client;
  const hm = await mk("Hugo Manager", "hiring_manager", [c.drive_id]);
  const viewer = await mk("Vera Viewer", "viewer");
  const otherEmail = `iso9.${stamp}@iso.test`;
  await admin.json("POST", "/api/platform/orgs", { name: `Talent Iso ${stamp}`, admin: { name: "Ola Admin", email: otherEmail, password: pw } });
  const other = await new Client().login(otherEmail, pw);

  /* --------------------------------- Sources -------------------------------- */
  const { id: newDrive } = await recruiter.json<{ id: string }>("POST", "/api/drives", { title: `Platform Engineer ${stamp}`, jdText: JD });
  await recruiter.json("POST", `/api/drives/${newDrive}/publish`, {});
  const csvInv = await recruiter.json<{ results: { candidacyId: string }[] }>("POST", `/api/drives/${newDrive}/invites`, { candidates: [{ name: "Cara Csv", email: `cara.${stamp}@example.com` }], source: "csv" });
  const oneInv = await recruiter.json<{ results: { candidacyId: string; link: string }[] }>("POST", `/api/drives/${newDrive}/invites`, { candidates: [{ name: "Ivan Invite", email: `ivan.${stamp}@example.com` }] });
  const [{ open_slug: slug }] = await q<{ open_slug: string }>("select open_slug from drives where id = $1", [newDrive]);
  await q("delete from rate_limits where key like 'register:%'");
  const reg = await new Client().json<{ token: string }>("POST", "/api/public/register", { slug, name: "Olu Open", email: `olu.${stamp}@example.com` });
  const srcs = await q<{ source: string; id: string; access_token: string }>("select source, id, access_token from candidacies where drive_id = $1", [newDrive]);
  check(srcs.find((s) => s.id === csvInv.results[0].candidacyId)?.source === "csv", "CSV imports are recorded as the CSV source");
  check(srcs.find((s) => s.id === oneInv.results[0].candidacyId)?.source === "invite", "individual invites are recorded as invites");
  check(srcs.find((s) => s.access_token === reg.token)?.source === "open", "open-link registrations are recorded as open link");

  /* ----------------------------- Pool consent ------------------------------- */
  const cand = new Client();
  check((await cand.req("POST", `/api/c/${c.access_token}/talent-pool`, { months: 7 })).status === 400, "only 6, 12 or 24 months can be chosen");
  const hubBefore = await cand.req("GET", `/c/${c.access_token}`);
  check(hubBefore.text.includes("Keep me in mind") && hubBefore.text.includes("You can leave at any time"), "the candidate is offered the talent pool with a clear explanation");
  const joined = await cand.json<{ expiresAt: string }>("POST", `/api/c/${c.access_token}/talent-pool`, { months: 12 });
  const monthsAhead = (Date.parse(joined.expiresAt) - Date.now()) / (30.44 * 86_400_000);
  check(Math.abs(monthsAhead - 12) < 0.1, "joining for 12 months keeps them on file for 12 months");
  check((await cand.req("GET", `/c/${c.access_token}`)).text.includes("talent pool until"), "the candidate sees they're in the pool and until when");
  const exp = await cand.json<{ you: { talentPool: { until: string } | null }; panelInterviews: unknown[] }>("GET", `/api/c/${c.access_token}/data`);
  check(exp.you.talentPool?.until && Array.isArray(exp.panelInterviews), "the data download shows the pool membership (and any panel interviews)");
  const fresh = new Client();
  const [invitedTok] = await q<{ access_token: string }>("select access_token from candidacies where id = $1", [oneInv.results[0].candidacyId]);
  check((await fresh.req("POST", `/api/c/${invitedTok.access_token}/talent-pool`, { months: 6 })).status === 404, "the pool can't be joined before giving consent to the interview");

  /* --------------------------------- Search --------------------------------- */
  check((await hm.client.req("GET", "/app/talent")).status !== 200, "hiring managers can't browse the talent pool");
  check((await viewer.client.req("GET", "/app/talent")).status !== 200, "viewers can't browse the talent pool");
  const byName = await recruiter.req("GET", `/app/talent?q=${encodeURIComponent(c.email)}`);
  check(byName.status === 200 && byName.text.includes(c.name) && byName.text.includes("talent pool"), "recruiters find people by email, with their pool status");
  const pooled = await recruiter.req("GET", "/app/talent?pool=1");
  check(pooled.text.includes(c.name) && !pooled.text.includes("Ivan Invite"), "the pool filter shows only people who opted in");
  const [{ raw_text: raw }] = await q<{ raw_text: string }>("select raw_text from resumes where candidacy_id = $1", [c.id]);
  const skill = ["Kafka", "PostgreSQL", "Redis", "TypeScript", "Kubernetes"].find((s) => raw.includes(s)) ?? raw.split(/\s+/).find((w) => w.length > 6)!;
  check((await recruiter.req("GET", `/app/talent?q=${encodeURIComponent(skill)}&pool=1`)).text.includes(c.name), `search matches resume text (“${skill}”)`);
  check(!(await other.req("GET", `/app/talent?q=${encodeURIComponent(c.email)}`)).text.includes(c.name), "another organisation can't find this organisation's candidates");

  /* ---------------------------------- Tags ---------------------------------- */
  const t = await recruiter.json<{ tags: string[] }>("PUT", `/api/talent/${c.candidate_id}/tags`, { tags: [" Silver Medalist ", "payments", "silver medalist"] });
  check(JSON.stringify(t.tags) === JSON.stringify(["silver medalist", "payments"]), "tags are normalised and de-duplicated");
  check((await recruiter.req("GET", "/app/talent?tag=silver%20medalist")).text.includes(c.name), "search filters by tag");
  check((await hm.client.req("PUT", `/api/talent/${c.candidate_id}/tags`, { tags: ["x"] })).status === 403, "hiring managers can't tag");
  check((await other.req("PUT", `/api/talent/${c.candidate_id}/tags`, { tags: ["x"] })).status === 404, "another organisation can't tag this candidate");

  /* -------------------------------- Profile --------------------------------- */
  const prof = await recruiter.req("GET", `/app/talent/${c.candidate_id}`);
  check(prof.status === 200 && prof.text.includes("In the talent pool until") && prof.text.includes("Applications") && prof.text.includes("Invite to this drive"), "the profile shows applications, pool status and the re-invite option");
  check((await other.req("GET", `/app/talent/${c.candidate_id}`)).status === 404, "another organisation can't open the profile");

  /* -------------------------------- Re-invite ------------------------------- */
  check((await hm.client.req("POST", `/api/talent/${c.candidate_id}/invite`, { driveId: newDrive })).status === 403, "hiring managers can't re-invite");
  check((await other.req("POST", `/api/talent/${c.candidate_id}/invite`, { driveId: newDrive })).status === 404, "another organisation can't re-invite");
  const [ivan] = await q<{ candidate_id: string }>("select candidate_id from candidacies where id = $1", [oneInv.results[0].candidacyId]);
  check((await recruiter.req("POST", `/api/talent/${ivan.candidate_id}/invite`, { driveId: c.drive_id })).status === 409, "people who didn't opt in can't be re-invited");
  const re = await recruiter.json<{ candidacyId: string; resumeReused: boolean }>("POST", `/api/talent/${c.candidate_id}/invite`, { driveId: newDrive });
  check(re.resumeReused, "re-inviting reuses their latest resume");
  check((await recruiter.req("POST", `/api/talent/${c.candidate_id}/invite`, { driveId: newDrive })).status === 409, "they can't be invited to the same drive twice");
  const [nc] = await q<{ source: string; access_token: string }>("select source, access_token from candidacies where id = $1", [re.candidacyId]);
  check(nc.source === "reinvite", "the new application is recorded as a talent-pool re-invite");
  const parsed = await waitFor("resume re-analysis", async () => (await q<{ status: string; jd_match: unknown }>("select status, jd_match from resumes where candidacy_id = $1", [re.candidacyId]))[0], 90_000).then(() =>
    waitFor("parsed", async () => {
      const [r] = await q<{ status: string; jd_match: unknown }>("select status, jd_match from resumes where candidacy_id = $1", [re.candidacyId]);
      return r.status === "parsed" && r.jd_match ? r : null;
    }),
  );
  check(parsed.jd_match, "the copied resume is re-matched against the new role");
  const nt = new Client();
  await nt.json("POST", `/api/c/${nc.access_token}/consent`, { accept: true, webcam: true });
  const nhub = await nt.req("GET", `/c/${nc.access_token}`);
  check(nhub.text.includes("Review your profile") && !nhub.text.includes("Upload your resume"), "after consenting they skip the upload and go straight to confirming their profile");
  const reAudit = await q("select 1 from audit_log where action = 'talent.reinvite' and entity_id = $1", [re.candidacyId]);
  check(reAudit.length === 1, "re-invites are audited");

  /* ---------------------------------- Leave --------------------------------- */
  await cand.json("POST", `/api/c/${c.access_token}/talent-pool`, { months: null });
  const [left] = await q<{ pool_expires_at: Date | null }>("select pool_expires_at from candidates where id = $1", [c.candidate_id]);
  check(!left.pool_expires_at && (await cand.req("GET", `/c/${c.access_token}`)).text.includes("Keep me in mind"), "the candidate can leave the pool at any time");
  const { id: drive3 } = await recruiter.json<{ id: string }>("POST", "/api/drives", { title: `SRE ${stamp}`, jdText: JD });
  await recruiter.json("POST", `/api/drives/${drive3}/publish`, {});
  check((await recruiter.req("POST", `/api/talent/${c.candidate_id}/invite`, { driveId: drive3 })).status === 409, "after leaving, they can't be re-invited");

  /* --------------------------------- Insights ------------------------------- */
  const ins = await recruiter.req("GET", "/app/insights?days=30");
  check(ins.status === 200 && ins.text.includes("Hiring insights") && ins.text.includes("Funnel") && ins.text.includes("Talent pool") && ins.text.includes("CSV import") && ins.text.includes("Open link"), "insights show the funnel and where candidates came from");
  check(ins.text.includes("People&#x27;s decisions vs the AI") || ins.text.includes("People's decisions vs the AI"), "insights compare people's decisions with the AI");
  check(ins.text.includes("Agreement between panelists"), "insights report agreement between panelists");
  const scoped = await recruiter.req("GET", `/app/insights?days=30&drive=${newDrive}`);
  check(scoped.text.includes("CSV import") && !scoped.text.includes("Before tracking"), "insights can be narrowed to one drive");
  check((await hm.client.req("GET", "/app/insights")).status !== 200, "hiring managers can't open organisation-wide insights");
  const csv = await recruiter.req("GET", "/api/insights/export?days=30");
  const [{ n }] = await q<{ n: number }>("select count(*)::int as n from candidacies where org_id = $1 and created_at >= now() - interval '30 days'", [orgId]);
  const lines = csv.text.trim().split("\n");
  check(csv.type.includes("text/csv") && lines[0].startsWith("candidacyId,drive,source") && lines.length - 1 === n, `the CSV has one row per candidacy in the period (${n})`);
  check(!csv.text.includes("@example.com") && csv.text.includes('"reinvite"'), "the CSV carries no names or emails, and includes sources");
  check((await hm.client.req("GET", "/api/insights/export")).status === 403, "hiring managers can't export insights");
  check((await other.req("GET", "/app/insights")).text.includes("No candidates in this period"), "another organisation's insights don't include this organisation's candidates");

  await db.end();
  console.log(`\nPHASE 9 CHECKS PASSED (${passed} checks)`);
}

main().catch((e) => {
  console.error("\nPHASE 9 CHECKS FAILED:", e);
  process.exit(1);
});
