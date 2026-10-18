/**
 * Phase 10 checks: talent-pool matching for a drive (fit score and explanation, ordering, who is listed), bulk invites,
 * the staff inbox per role with the nav badge, the daily digest, and isolation. Uses data from the earlier smoke tests.
 *   BASE_URL=http://localhost:3000 npx tsx scripts/smoke-phase10.ts
 */
import "./load-env";
import pg from "pg";
import { sendDigests } from "../src/lib/services/inbox";

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

const JD = `We are hiring a Senior Backend Engineer for our ledger team: Node.js services on PostgreSQL with Kafka event streams, some Go, deployed on Kubernetes with Terraform. 5+ years of backend experience. Responsibilities: design and own payment ledger services, review designs, mentor engineers and keep production reliable with good observability and on-call practices.`;

async function main() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const q = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows as T[];
  const stamp = Date.now();
  const admin = await new Client().login(process.env.ADMIN_EMAIL!, process.env.ADMIN_PASSWORD!);
  const [{ org_id: orgId }] = await q<{ org_id: string }>("select org_id from users where email = $1", [process.env.ADMIN_EMAIL!.toLowerCase()]);
  const pw = "Marigold-Compass-47";
  const mk = async (name: string, role: string, driveIds?: string[]) => {
    const email = `${name.toLowerCase().replace(/\s/g, ".")}.${stamp}@inbox.test`;
    const { id } = await admin.json<{ id: string }>("POST", "/api/settings/users", { name, email, password: pw, role });
    if (driveIds) await admin.json("PUT", `/api/settings/users/${id}`, { driveIds });
    return { id, email, client: await new Client().login(email, pw) };
  };
  const recruiter = (await mk("Rhea Sourcer", "recruiter")).client;

  /* ------------------------------ A fresh drive ----------------------------- */
  const { id: driveId } = await recruiter.json<{ id: string }>("POST", "/api/drives", { title: `Ledger Engineer ${stamp}`, jdText: JD });
  await recruiter.json("POST", `/api/drives/${driveId}/publish`, {});
  // Pin the role's skills so the expected matches are known.
  await q(
    `update drive_versions set config = jsonb_set(jsonb_set(jsonb_set(config, '{roleProfile,mustHaveSkills}', $2::jsonb), '{roleProfile,niceToHaveSkills}', $3::jsonb), '{roleProfile,seniority}', '"senior"')
      where id = (select current_version_id from drives where id = $1)`,
    [driveId, JSON.stringify(["Node.js", "PostgreSQL", "Kafka", "Go"]), JSON.stringify(["Kubernetes", "Terraform"])],
  );

  // Three different people with parsed resumes: two strong fits in the pool, one weak fit in the pool, one not in the pool.
  const people = await q<{ candidate_id: string; name: string; resume_id: string; access_token: string }>(
    `select distinct on (c.candidate_id) c.candidate_id, cand.name, r.id as resume_id, c.access_token
       from candidacies c join candidates cand on cand.id = c.candidate_id join resumes r on r.candidacy_id = c.id
      where c.org_id = $1 and r.parsed is not null and c.stage not in ('invited', 'declined')
      order by c.candidate_id, r.created_at desc limit 4`,
    [orgId],
  );
  if (people.length < 4) throw new Error("Need 4 candidates with parsed resumes — run `npm run smoke` a few times first");
  const [strong1, strong2, weak, outside] = people;
  // Earlier smoke runs reuse one name; give these four distinct names so the page checks are unambiguous.
  for (const [p, label] of [[strong1, "Sana Strongfit"], [strong2, "Dev Goodfit"], [weak, "Wen Weakfit"], [outside, "Otto Outside"]] as const) {
    p.name = `${label} ${stamp % 100000}`;
    await q("update candidates set name = $2 where id = $1", [p.candidate_id, p.name]);
  }
  const skills = (names: string[]) => JSON.stringify(names.map((n) => ({ name: n, category: "framework", evidence: "experience" })));
  const exp = JSON.stringify([{ company: "PayCo", title: "Senior Engineer", start: "2017", end: "present", bullets: [], technologies: [], teamSizeManaged: null }]);
  await q("update resumes set parsed = jsonb_set(jsonb_set(parsed, '{skills}', $2::jsonb), '{experience}', $3::jsonb) where candidacy_id in (select id from candidacies where candidate_id = $1)", [strong1.candidate_id, skills(["Node.js", "Postgres", "Apache Kafka", "Golang", "K8s"]), exp]);
  await q("update resumes set parsed = jsonb_set(jsonb_set(parsed, '{skills}', $2::jsonb), '{experience}', $3::jsonb) where candidacy_id in (select id from candidacies where candidate_id = $1)", [strong2.candidate_id, skills(["NodeJS", "PostgreSQL", "Kafka", "Redis"]), exp]);
  await q("update resumes set parsed = jsonb_set(parsed, '{skills}', $2::jsonb) where candidacy_id in (select id from candidacies where candidate_id = $1)", [weak.candidate_id, skills(["Java", "Spring Boot"])]);
  // Start from an empty pool (earlier test runs leave people in it), then add our three.
  await q("update candidates set pool_consent_at = null, pool_expires_at = null where org_id = $1", [orgId]);
  await q("update candidates set pool_consent_at = now(), pool_expires_at = now() + interval '1 year' where id = any($1::uuid[])", [[strong2.candidate_id, weak.candidate_id]]);
  await q("update candidates set pool_consent_at = null, pool_expires_at = null where id = $1", [outside.candidate_id]);
  // The first strong fit joins the pool through their own page.
  await new Client().json("POST", `/api/c/${strong1.access_token}/talent-pool`, { months: 12 });

  /* ------------------------------- Suggestions ------------------------------ */
  const page = await recruiter.req("GET", `/app/drives/${driveId}`);
  check(page.text.includes("Suggested from your talent pool"), "an active drive suggests people from the talent pool");
  const i1 = page.text.indexOf(strong1.name);
  const i2 = page.text.indexOf(strong2.name);
  check(i1 > 0 && i2 > 0 && i1 < i2, "the best fit is listed first (all four must-haves beats three)");
  check(page.text.includes("Has: Node.js, PostgreSQL, Kafka, Go") && page.text.includes("Bonus: Kubernetes"), "suggestions explain the fit with skill aliases resolved (Postgres, Golang, K8s)");
  check(page.text.includes("Missing: Go"), "missing must-have skills are named");
  check(!page.text.includes(weak.name), "weak fits are left out");
  check(!page.text.includes(outside.name), "people who didn't opt in are never suggested");
  const hm = await mk("Hana Inbox", "hiring_manager", [driveId]);
  check(!(await hm.client.req("GET", `/app/drives/${driveId}`)).text.includes("Suggested from your talent pool"), "hiring managers don't see pool suggestions");

  /* ------------------------------- Bulk invite ------------------------------ */
  const otherEmail = `iso10.${stamp}@iso.test`;
  await admin.json("POST", "/api/platform/orgs", { name: `Inbox Iso ${stamp}`, admin: { name: "Iris Admin", email: otherEmail, password: pw } });
  const other = await new Client().login(otherEmail, pw);
  check((await other.req("POST", `/api/drives/${driveId}/pool-invites`, { candidateIds: [strong1.candidate_id] })).status === 404, "another organisation can't invite into this drive");
  check((await hm.client.req("POST", `/api/drives/${driveId}/pool-invites`, { candidateIds: [strong1.candidate_id] })).status === 403, "hiring managers can't bulk-invite");
  check((await recruiter.req("POST", `/api/drives/${driveId}/pool-invites`, { candidateIds: Array.from({ length: 26 }, () => strong1.candidate_id) })).status === 400, "at most 25 people per bulk invite");
  const bulk = await recruiter.json<{ results: { candidateId: string; status: string; message?: string }[] }>("POST", `/api/drives/${driveId}/pool-invites`, { candidateIds: [strong1.candidate_id, strong2.candidate_id, outside.candidate_id] });
  const st = (id: string) => bulk.results.find((r) => r.candidateId === id);
  check(st(strong1.candidate_id)?.status === "invited" && st(strong2.candidate_id)?.status === "invited", "selected pool members are invited together");
  check(st(outside.candidate_id)?.status === "error" && /agreed/.test(st(outside.candidate_id)?.message ?? ""), "people outside the pool are reported, not invited");
  const srcs = await q<{ source: string }>("select source from candidacies where drive_id = $1", [driveId]);
  check(srcs.length === 2 && srcs.every((s) => s.source === "reinvite"), "bulk invites are recorded as talent-pool re-invites");
  // Both strong fits are now in the drive (its candidate list), and the weak fit is below the bar: nothing left to suggest.
  check(!(await recruiter.req("GET", `/app/drives/${driveId}`)).text.includes("Suggested from your talent pool"), "invited people drop out of the suggestions");

  /* ---------------------------------- Inbox --------------------------------- */
  // Work for each role: a gate decision, a scorecard due, an adjustment request and a deletion request.
  const [gateCand] = await q<{ id: string; stage: string; name: string }>("select c.id, c.stage, cand.name from candidacies c join candidates cand on cand.id = c.candidate_id where c.drive_id = $1 limit 1", [driveId]);
  await q("update candidacies set stage = 'gate_pending', updated_at = now() where id = $1", [gateCand.id]);
  const [panelCand] = await q<{ id: string; drive_id: string; name: string }>(
    `select c.id, c.drive_id, cand.name from candidacies c join candidates cand on cand.id = c.candidate_id join combined_reports r on r.candidacy_id = c.id and r.status = 'ready'
      where c.org_id = $1 and c.stage in ('completed', 'shortlisted') order by c.created_at desc limit 1`,
    [orgId],
  );
  await admin.json("PUT", `/api/settings/users/${hm.id}`, { driveIds: [driveId, panelCand.drive_id] });
  const iv = await recruiter.json<{ id: string }>("POST", `/api/candidacies/${panelCand.id}/panel`, { title: "Inbox panel", durationMin: 30, location: "https://meet.example.com/inbox", slots: [new Date(Date.now() + 86_400_000).toISOString()], panelistIds: [hm.id], competencies: ["Depth"] });
  await q("update panel_interviews set scheduled_at = now() - interval '2 hours' where id = $1", [iv.id]);
  const [adjCand] = await q<{ access_token: string; name: string }>("select c.access_token, cand.name from candidacies c join candidates cand on cand.id = c.candidate_id where c.drive_id = $1 and c.id <> $2 limit 1", [driveId, gateCand.id]);
  await new Client().json("POST", `/api/c/${adjCand.access_token}/consent`, { accept: true, webcam: true }).catch(() => undefined);
  await new Client().json("POST", `/api/c/${adjCand.access_token}/accommodation`, { extraTimePct: 25, extraBreaks: false });

  const hmInbox = await hm.client.req("GET", "/app/inbox");
  check(hmInbox.status === 200 && hmInbox.text.includes("Your scorecards to submit") && hmInbox.text.includes(panelCand.name), "a panelist's inbox lists their scorecard due");
  check(hmInbox.text.includes("Round decisions waiting") && hmInbox.text.includes(gateCand.name), "decision makers see round decisions waiting");
  check(!hmInbox.text.includes("Interview adjustment requests"), "hiring managers don't see adjustment requests");
  const recInbox = await recruiter.req("GET", "/app/inbox");
  check(recInbox.text.includes("Interview adjustment requests") && recInbox.text.includes(adjCand.name), "recruiters see adjustment requests");
  check(!recInbox.text.includes("Your scorecards to submit"), "people not on a panel have no scorecards due");
  const badge = (await hm.client.req("GET", "/app")).text.match(/Inbox, (\d+) waiting/);
  check(badge && Number(badge[1]) >= 2, "the nav shows how many things are waiting");
  await hm.client.json("PUT", `/api/panel/${iv.id}/scorecard`, { ratings: { Depth: 4 }, recommendation: "hire" });
  check(!(await hm.client.req("GET", "/app/inbox")).text.includes("Your scorecards to submit"), "a submitted scorecard leaves the inbox");
  const finalReady = await hm.client.req("GET", "/app/inbox");
  check(finalReady.text.includes("ready for a final decision") && finalReady.text.includes(panelCand.name), "once every scorecard is in, the candidate shows as ready for the final decision");
  const viewer = await mk("Vito Viewer", "viewer");
  const vInbox = await viewer.client.req("GET", "/app/inbox");
  check(vInbox.status === 200 && vInbox.text.includes("all caught up"), "viewers have an empty inbox");
  const oInbox = await other.req("GET", "/app/inbox");
  check(!oInbox.text.includes(gateCand.name) && !oInbox.text.includes(adjCand.name), "another organisation's inbox shows none of this organisation's work");
  await new Client().json("POST", `/api/c/${adjCand.access_token}/deletion`, { reason: "Inbox test" });
  const adminInbox = await admin.req("GET", "/app/inbox");
  check(adminInbox.text.includes("Candidate data deletion requests"), "admins see data deletion requests");

  /* --------------------------------- Digest --------------------------------- */
  await hm.client.json("PUT", "/api/auth/digest", { optIn: true });
  await viewer.client.json("PUT", "/api/auth/digest", { optIn: true });
  const [{ digest_opt_in: on }] = await q<{ digest_opt_in: boolean }>("select digest_opt_in from users where id = $1", [hm.id]);
  check(on, "staff can opt in to the daily summary");
  const early = new Date(new Date().setUTCHours(5, 0, 0, 0));
  await sendDigests(early);
  check(!(await q<{ digest_sent_at: Date | null }>("select digest_sent_at from users where id = $1", [hm.id]))[0].digest_sent_at, "no digest goes out before 07:00 UTC");
  const morning = new Date(new Date().setUTCHours(8, 0, 0, 0));
  await sendDigests(morning);
  const [sent] = await q<{ digest_sent_at: Date | null }>("select digest_sent_at from users where id = $1", [hm.id]);
  check(sent.digest_sent_at?.getTime() === morning.getTime(), "the digest goes out in the morning to people who opted in");
  await sendDigests(new Date(morning.getTime() + 3 * 3600_000));
  const [again] = await q<{ digest_sent_at: Date }>("select digest_sent_at from users where id = $1", [hm.id]);
  check(again.digest_sent_at.getTime() === morning.getTime(), "at most one digest a day");
  await hm.client.json("PUT", "/api/auth/digest", { optIn: false });

  // Tidy up: put the borrowed candidacy back.
  await q("update candidacies set stage = $2 where id = $1", [gateCand.id, gateCand.stage]);
  await db.end();
  console.log(`\nPHASE 10 CHECKS PASSED (${passed} checks)`);
}

main().catch((e) => {
  console.error("\nPHASE 10 CHECKS FAILED:", e);
  process.exit(1);
});
