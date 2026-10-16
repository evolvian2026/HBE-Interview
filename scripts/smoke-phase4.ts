/**
 * Multi-tenancy checks (Phase 4). Run after `npm run smoke` and `npm run smoke:phase3` against the same server:
 *   BASE_URL=http://localhost:3000 npx tsx scripts/smoke-phase4.ts
 * Creates a second organisation and verifies, route by route, that its admin can neither read nor change the
 * first organisation's data; then checks per-org settings, candidates, API keys, org switching and suspension.
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
  cookie = "";
  constructor(public bearer?: string) {}
  async req(method: string, path: string, body?: unknown) {
    const res = await fetch(BASE + path, {
      method,
      redirect: "manual",
      headers: {
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(this.bearer ? { authorization: `Bearer ${this.bearer}` } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.get("set-cookie");
    if (sc) this.cookie = sc.split(";")[0];
    return { status: res.status, text: await res.text() };
  }
  async json<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await this.req(method, path, body);
    if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status}: ${r.text}`);
    return JSON.parse(r.text || "{}") as T;
  }
  async login(email: string, password: string) {
    return this.req("POST", "/api/auth/login", { email, password });
  }
}

const denied = (s: number) => s === 403 || s === 404;

async function main() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const q = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows as T[];

  const platform = new Client();
  check((await platform.login(process.env.ADMIN_EMAIL!, process.env.ADMIN_PASSWORD!)).status === 200, "platform admin signs in");
  const [{ org_id: orgA }] = await q<{ org_id: string }>("select org_id from users where email = $1", [process.env.ADMIN_EMAIL!.toLowerCase()]);

  /* ----------------------------- org A fixtures ----------------------------- */
  const [cand] = await q<{ id: string; drive_id: string }>(
    "select c.id, c.drive_id from candidacies c join combined_reports r on r.candidacy_id = c.id where c.org_id = $1 and r.status = 'ready' order by c.created_at desc limit 1",
    [orgA],
  );
  check(cand, "org A has a completed candidate (run npm run smoke first)");
  const [rep] = await q<{ id: string }>("select id from round_reports where candidacy_id = $1 limit 1", [cand.id]);
  const [snap] = await q<{ id: string }>("select p.id from proctor_snapshots p join round_sessions s on s.id = p.session_id join candidacies c on c.id = s.candidacy_id where c.org_id = $1 limit 1", [orgA]);
  const [kb] = await q<{ id: string }>("select id from kb_documents where org_id = $1 limit 1", [orgA]);
  const [userA] = await q<{ id: string; role: string }>("select id, role from users where org_id = $1 and platform_admin = false and role <> 'admin' limit 1", [orgA]);
  const [problem] = await q<{ id: string }>("select p.id from coding_problems p join drives d on d.id = p.drive_id where d.org_id = $1 limit 1", [orgA]);
  const share = await platform.json<{ id: string }>("POST", `/api/candidacies/${cand.id}/share`, { days: 3, masked: true });
  const hookA = await platform.json<{ id: string }>("POST", "/api/settings/webhooks", { url: "https://hooks.example.com/org-a", events: ["round.evaluated"] });
  const keyA = await platform.json<{ id: string; key: string }>("POST", "/api/settings/api-keys", { name: "org A key", scopes: ["drives:read", "candidates:read", "candidates:write"] });
  const [driveA] = await q<{ title: string; draft: unknown }>("select title, draft from drives where id = $1", [cand.drive_id]);
  const [candA] = await q<{ name: string; email: string }>("select cand.name, cand.email from candidacies c join candidates cand on cand.id = c.candidate_id where c.id = $1", [cand.id]);

  /* -------------------------------- org B -------------------------------- */
  const stamp = Date.now();
  const adminB = { name: "Bina Admin", email: `admin.b.${stamp}@acme.test`, password: "acme-pass-123" };
  const orgB = await platform.json<{ id: string; slug: string }>("POST", "/api/platform/orgs", { name: `Acme ${stamp}`, admin: adminB });
  check(orgB.id && orgB.slug.startsWith("acme"), "platform admin creates organisation B with its first admin");
  const dup = await platform.req("POST", "/api/platform/orgs", { name: "Dup", admin: { ...adminB, name: "x" } });
  check(dup.status === 409, "creating an organisation with an existing user email is rejected");

  const b = new Client();
  check((await b.login(adminB.email, adminB.password)).status === 200, "org B admin signs in");

  // Pages: other org's resources are 404.
  const pages = [
    `/app/drives/${cand.drive_id}`,
    `/app/drives/${cand.drive_id}/analytics`,
    `/app/drives/${cand.drive_id}/fairness`,
    `/app/drives/${cand.drive_id}/edit`,
    `/app/drives/${cand.drive_id}/problems`,
    `/app/drives/${cand.drive_id}/compare?ids=${cand.id}&ids=${cand.id}`,
    `/app/candidates/${cand.id}`,
    `/print/candidates/${cand.id}`,
    `/app/platform`,
  ];
  for (const p of pages) check((await b.req("GET", p)).status === 404, `org B gets 404 for org A page ${p.split("?")[0]}`);

  // Every ID-based staff API route.
  const routes: [string, string, unknown?][] = [
    ["PUT", `/api/drives/${cand.drive_id}`, { config: driveA.draft }],
    ["POST", `/api/drives/${cand.drive_id}/publish`, {}],
    ["POST", `/api/drives/${cand.drive_id}/status`, { status: "paused" }],
    ["POST", `/api/drives/${cand.drive_id}/analyze`, {}],
    ["POST", `/api/drives/${cand.drive_id}/invites`, { candidates: [{ name: "Intruder", email: "intruder@example.com" }] }],
    ["POST", `/api/drives/${cand.drive_id}/problems`, { title: "x", difficulty: "easy", statement: "x".repeat(40), samples: [{ input: "1", output: "1" }], hidden: [{ input: "1", output: "1" }, { input: "1", output: "1" }, { input: "1", output: "1" }], referenceLanguage: "python", referenceCode: "print(input())" }],
    ...(problem ? ([["DELETE", `/api/problems/${problem.id}`]] as [string, string][]) : []),
    ["POST", `/api/candidacies/${cand.id}/combined`, {}],
    ["POST", `/api/candidacies/${cand.id}/feedback`, {}],
    ["PUT", `/api/candidacies/${cand.id}/feedback`, { summary: { strengths: ["x"], growthAreas: ["y"], note: "z" }, release: true }],
    ["POST", `/api/candidacies/${cand.id}/gate`, { decision: "reject" }],
    ["POST", `/api/candidacies/${cand.id}/notes`, { text: "cross-tenant note" }],
    ["GET", `/api/candidacies/${cand.id}/resume`],
    ["POST", `/api/candidacies/${cand.id}/retake`, { roundIndex: 0, reason: "cross-tenant retake" }],
    ["POST", `/api/candidacies/${cand.id}/share`, { days: 3, masked: false }],
    ["POST", `/api/candidacies/${cand.id}/status`, { status: "rejected" }],
    ["DELETE", `/api/candidacies/${cand.id}`],
    ["POST", `/api/reports/${rep.id}/override`, { parameter: "x", score: 1, reason: "cross-tenant override" }],
    ["POST", `/api/reports/${rep.id}/reevaluate`, {}],
    ["DELETE", `/api/share/${share.id}`],
    ...(snap ? ([["GET", `/api/proctor/${snap.id}`]] as [string, string][]) : []),
    ...(kb ? ([["DELETE", `/api/settings/kb/${kb.id}`]] as [string, string][]) : []),
    ...(userA ? ([["PUT", `/api/settings/users/${userA.id}`, { role: "admin", active: false }]] as [string, string, unknown][]) : []),
    ["PUT", `/api/settings/webhooks/${hookA.id}`, { active: false }],
    ["POST", `/api/settings/webhooks/${hookA.id}/test`],
    ["DELETE", `/api/settings/webhooks/${hookA.id}`],
    ["DELETE", `/api/settings/api-keys/${keyA.id}`],
    ["POST", "/api/platform/orgs", { name: "Sneaky", admin: { name: "x", email: `x.${stamp}@x.test`, password: "12345678" } }],
    ["PUT", `/api/platform/orgs/${orgA}`, { status: "suspended" }],
    ["POST", "/api/platform/switch", { orgId: orgA }],
    ["PUT", "/api/platform/settings", { interviewerEffort: "low" }],
  ];
  for (const [m, p, body] of routes) {
    const r = await b.req(m, p, body);
    check(denied(r.status), `org B denied ${m} ${p.replace(/[0-9a-f-]{36}/g, ":id")} (${r.status})`);
  }

  // Nothing in org A changed.
  const [after] = await q<{ stage: string; title: string; status: string }>("select c.stage, d.title, d.status from candidacies c join drives d on d.id = c.drive_id where c.id = $1", [cand.id]);
  check(after && after.title === driveA.title && after.status === "active", "org A's drive is unchanged");
  check((await q("select 1 from candidacy_notes where candidacy_id = $1 and text = 'cross-tenant note'", [cand.id])).length === 0, "no note was added to org A's candidate");
  check((await q("select 1 from webhooks where id = $1 and active", [hookA.id])).length === 1, "org A's webhook still exists and is active");
  check((await q("select 1 from api_keys where id = $1 and revoked_at is null", [keyA.id])).length === 1, "org A's API key is not revoked");
  check((await q("select 1 from share_links where id = $1 and revoked_at is null", [share.id])).length === 1, "org A's share link is not revoked");
  if (userA) check((await q<{ role: string }>("select role from users where id = $1", [userA.id]))[0].role === userA.role, "org A's user role is unchanged");
  if (kb) check((await q("select 1 from kb_documents where id = $1", [kb.id])).length === 1, "org A's KB document still exists");
  check((await q("select 1 from candidates where email = 'intruder@example.com'")).length === 0, "no candidate was invited into org A's drive");

  // Lists show only org B's data.
  const home = await b.req("GET", "/app");
  check(home.status === 200 && !home.text.includes(driveA.title), "org B's drive list doesn't include org A's drives");
  const settingsB = await b.req("GET", "/app/settings");
  check(settingsB.status === 200 && !settingsB.text.includes("org A key") && settingsB.text.includes(adminB.email) && !settingsB.text.includes(process.env.ADMIN_EMAIL!), "org B's settings show only its own users and keys");
  const gate = await b.req("GET", "/app/gate-queue");
  check(gate.status === 200 && !gate.text.includes(candA.name), "org B's decision queue doesn't include org A's candidates");
  const usage = await b.req("GET", "/app/usage?range=all");
  check(usage.status === 200, "org B's usage page renders (its own usage only)");

  /* ------------------------- org B's own pipeline ------------------------- */
  await b.json("PUT", "/api/settings", { companyName: "Acme Robotics" });
  const jd = `We are hiring a Backend Engineer for our robotics platform. You will build Python and Go services backed by PostgreSQL on AWS, design REST APIs, write tests and own reliability. Requirements: 3-5 years of backend experience, SQL, testing and CI/CD.`;
  const { id: driveB } = await b.json<{ id: string }>("POST", "/api/drives", { title: "Acme Backend Engineer", jdText: jd });
  await b.json("POST", `/api/drives/${driveB}/publish`, {});
  const [{ org_id: driveOrg }] = await q<{ org_id: string }>("select org_id from drives where id = $1", [driveB]);
  check(driveOrg === orgB.id, "drives created by org B belong to org B");
  check((await platform.req("GET", `/app/drives/${driveB}`)).status === 404, "org A (even a platform admin, at home) can't open org B's drive");

  // Same email in both organisations = two separate candidate records.
  const invB = await b.json<{ results: { link: string; status: string }[] }>("POST", `/api/drives/${driveB}/invites`, { candidates: [{ name: "Renamed In B", email: candA.email }] });
  check(invB.results[0].status === "invited", "org B invites a person who is also org A's candidate");
  const [aName] = await q<{ name: string }>("select cand.name from candidacies c join candidates cand on cand.id = c.candidate_id where c.id = $1", [cand.id]);
  check(aName.name === candA.name, "org A's candidate record (name) is untouched by org B's invite");
  const [same] = await q<{ n: number; orgs: number }>("select count(*)::int n, count(distinct org_id)::int orgs from candidates where email = $1", [candA.email]);
  check(same.n >= 2 && same.n === same.orgs, "the same email exists as separate candidate records, one per organisation");
  const hubB = await fetch(`${BASE}/c/${invB.results[0].link.split("/c/")[1]}`).then((r) => r.text());
  check(hubB.includes("Acme Robotics") && hubB.includes("Acme Backend Engineer"), "org B's candidate sees org B's company name");

  // API keys are org-scoped.
  const keyB = await b.json<{ key: string }>("POST", "/api/settings/api-keys", { name: "org B key", scopes: ["drives:read", "candidates:read", "candidates:write"] });
  const apiB = new Client(keyB.key);
  const drivesB = await apiB.json<{ data: { id: string }[] }>("GET", "/api/v1/drives");
  check(drivesB.data.length === 1 && drivesB.data[0].id === driveB, "org B's API key lists only org B's drives");
  check((await apiB.req("GET", `/api/v1/candidates/${cand.id}`)).status === 404, "org B's API key can't read org A's candidate");
  check((await apiB.req("POST", `/api/v1/drives/${cand.drive_id}/candidates`, { candidates: [{ name: "X", email: "x2@example.com" }] })).status === 404, "org B's API key can't invite into org A's drive");
  const listA = await apiB.json<{ data: unknown[] }>("GET", `/api/v1/drives/${cand.drive_id}/candidates`);
  check(listA.data.length === 0, "org B's API key sees no candidates for org A's drive id");
  const apiA = new Client(keyA.key);
  check(!(await apiA.json<{ data: { id: string }[] }>("GET", "/api/v1/drives")).data.some((d) => d.id === driveB), "org A's API key doesn't see org B's drive");

  // Webhooks fire only for the owning organisation: an org B event must not create deliveries for org A's hook.
  const before = (await q<{ n: number }>("select count(*)::int n from webhook_deliveries where webhook_id = $1", [hookA.id]))[0].n;
  await b.json("POST", `/api/drives/${driveB}/invites`, { candidates: [{ name: "Event Probe", email: `probe.${stamp}@example.com` }] });
  const hookB = await b.json<{ id: string }>("POST", "/api/settings/webhooks", { url: "https://hooks.example.com/org-b", events: ["candidate.invited"] });
  await b.json("POST", `/api/drives/${driveB}/invites`, { candidates: [{ name: "Event Probe 2", email: `probe2.${stamp}@example.com` }] });
  const afterA = (await q<{ n: number }>("select count(*)::int n from webhook_deliveries where webhook_id = $1", [hookA.id]))[0].n;
  const deliveriesB = (await q<{ n: number }>("select count(*)::int n from webhook_deliveries where webhook_id = $1", [hookB.id]))[0].n;
  check(afterA === before && deliveriesB === 1, "org B's events reach only org B's webhooks");

  /* ------------------------- platform admin switching ------------------------- */
  await platform.json("POST", "/api/platform/switch", { orgId: orgB.id });
  const inB = await platform.req("GET", "/app");
  check(inB.status === 200 && inB.text.includes("Acme Backend Engineer") && inB.text.includes("acting as an administrator"), "platform admin enters org B and sees its drives with a banner");
  check((await platform.req("GET", `/app/drives/${cand.drive_id}`)).status === 404, "while in org B, org A's drive is not visible");
  await platform.json("POST", "/api/platform/switch", { orgId: orgA });
  const backHome = await platform.req("GET", "/app");
  check(backHome.status === 200 && !backHome.text.includes("acting as an administrator") && !backHome.text.includes("Acme Backend Engineer"), "platform admin returns to their own organisation");
  const plat = await platform.req("GET", "/app/platform");
  check(plat.status === 200 && plat.text.includes(`Acme ${stamp}`) && plat.text.includes("New organisation"), "platform console lists organisations");

  /* -------------------------------- suspension -------------------------------- */
  await platform.json("PUT", `/api/platform/orgs/${orgB.id}`, { status: "suspended", aiBudgetUsd: 25 });
  check((await new Client().login(adminB.email, adminB.password)).status === 403, "suspended organisation's admin can't sign in");
  check((await b.req("GET", "/app")).status !== 200, "suspended organisation's existing session stops working");
  check((await apiB.req("GET", "/api/v1/drives")).status === 403, "suspended organisation's API key is refused");
  const hubSuspended = await fetch(`${BASE}/c/${invB.results[0].link.split("/c/")[1]}`);
  check(hubSuspended.status === 200, "candidate links keep working while an organisation is suspended");
  check((await platform.req("PUT", `/api/platform/orgs/${orgA}`, { status: "suspended" })).status === 400, "a platform admin can't suspend their own organisation");
  await platform.json("PUT", `/api/platform/orgs/${orgB.id}`, { status: "active" });
  check((await new Client().login(adminB.email, adminB.password)).status === 200, "reactivated organisation's admin can sign in again");

  /* ---------------------------- HR knowledge base search ---------------------------- */
  const filler = Array.from({ length: 250 }, (_, i) => `Section ${i}. General workplace guidance number ${i} covers conduct, equipment care, meeting etiquette and travel booking basics for staff.`).join("\n\n");
  const policy = `${filler}\n\nRelocation assistance: employees moving cities for the role receive a one-time relocation allowance of INR 50,000 and two weeks of company housing.\n\n${filler}`;
  await b.json("POST", "/api/settings/kb", { title: "Acme Employee Handbook", content: policy });
  await b.json("POST", "/api/settings/kb", { title: "छुट्टी नीति", content: "वार्षिक छुट्टी: हर कर्मचारी को साल में 18 दिन की वार्षिक छुट्टी मिलती है।" });
  const [{ n: chunksB }] = await q<{ n: number }>("select count(*)::int n from kb_chunks where org_id = $1", [orgB.id]);
  check(chunksB > 5, `large KB document is indexed into passages (${chunksB})`);
  const hit = await b.json<{ passages: { title: string; content: string }[] }>("GET", `/api/settings/kb/search?q=${encodeURIComponent("Is there any relocation assistance if I move cities?")}`);
  check(hit.passages[0]?.content.includes("INR 50,000") && hit.passages[0].title === "Acme Employee Handbook", "KB search returns the relocation passage first");
  const hi = await b.json<{ passages: { title: string }[] }>("GET", `/api/settings/kb/search?q=${encodeURIComponent("वार्षिक छुट्टी कितनी है?")}`);
  check(hi.passages[0]?.title === "छुट्टी नीति", "KB search works for Hindi questions");
  const none = await b.json<{ passages: unknown[] }>("GET", `/api/settings/kb/search?q=${encodeURIComponent("stock options vesting cliff")}`);
  check(none.passages.length === 0, "KB search returns nothing for an unrelated question");
  const crossKb = await platform.json<{ passages: { title: string }[] }>("GET", `/api/settings/kb/search?q=${encodeURIComponent("relocation assistance")}`);
  check(!crossKb.passages.some((p) => p.title === "Acme Employee Handbook"), "org A's KB search never returns org B's documents");
  const kbPage = await b.req("GET", "/app/settings");
  check(kbPage.text.includes("search mode"), "settings shows the KB is in search mode");

  /* ------------------------------ whiteboard in export ------------------------------ */
  const [wb] = await q<{ id: string }>(
    "select c.id from candidacies c join round_sessions s on s.candidacy_id = c.id join exercise_responses e on e.session_id = s.id where c.org_id = $1 and e.whiteboard_png is not null and jsonb_array_length(e.whiteboard) > 0 order by c.created_at desc limit 1",
    [orgA],
  );
  if (wb) {
    const named = await platform.req("GET", `/print/candidates/${wb.id}`);
    check(named.status === 200 && named.text.includes("System-design whiteboard (candidate"), "print export includes the system-design whiteboard");
    const maskedPrint = await platform.req("GET", `/print/candidates/${wb.id}?masked=1`);
    check(maskedPrint.text.includes("whiteboard omitted from the identity-masked export") && !maskedPrint.text.includes("data:image/png"), "identity-masked export leaves the drawing out");
  }

  // Clean up fixtures created here (the example.com webhooks would otherwise keep retrying).
  await b.json("DELETE", `/api/settings/webhooks/${hookB.id}`);
  await platform.json("DELETE", `/api/settings/webhooks/${hookA.id}`);
  await platform.json("DELETE", `/api/settings/api-keys/${keyA.id}`);
  await platform.json("DELETE", `/api/share/${share.id}`);
  await db.end();
  console.log(`\nPHASE 4 TENANCY CHECKS PASSED (${passed} checks)\norg B: ${orgB.id}\nORG_B_ADMIN_EMAIL=${adminB.email} ORG_B_ADMIN_PASSWORD=${adminB.password}`);
}

main().catch((e) => {
  console.error("\nPHASE 4 TENANCY CHECKS FAILED:", e);
  process.exit(1);
});
