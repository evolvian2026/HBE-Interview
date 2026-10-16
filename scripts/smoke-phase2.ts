/**
 * HTTP checks for Phase 2 features. Run after `npm run smoke` against the same server:
 *   BASE_URL=http://localhost:3000 npx tsx scripts/smoke-phase2.ts
 */
import "./load-env";
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

class Client {
  cookie = "";
  async req(method: string, path: string, body?: unknown) {
    const res = await fetch(BASE + path, {
      method,
      redirect: "manual",
      headers: { ...(this.cookie ? { cookie: this.cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.get("set-cookie");
    if (sc) this.cookie = [this.cookie, sc.split(";")[0]].filter(Boolean).join("; ");
    return { status: res.status, text: await res.text() };
  }
  async json<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await this.req(method, path, body);
    if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status}: ${r.text}`);
    return JSON.parse(r.text || "{}") as T;
  }
}

function check(cond: unknown, msg: string) {
  if (!cond) throw new Error(`CHECK FAILED: ${msg}`);
  console.log("✓", msg);
}

async function main() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const { rows } = await db.query(
    "select c.id, c.drive_id from candidacies c join combined_reports r on r.candidacy_id = c.id where r.status = 'ready' order by c.created_at desc limit 2",
  );
  check(rows.length === 2, "two completed candidates available (run npm run smoke twice first)");
  const [a, b] = rows;

  const admin = new Client();
  await admin.json("POST", "/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });

  // Analytics, usage, compare render
  const an = await admin.req("GET", `/app/drives/${a.drive_id}/analytics`);
  check(an.status === 200 && an.text.includes("Funnel") && an.text.includes("Score distributions"), "drive analytics page renders");
  const us = await admin.req("GET", "/app/usage?range=all");
  check(us.status === 200 && us.text.includes("Cost by pipeline stage"), "AI usage page renders");
  const sameDrive = await db.query("select c.id from candidacies c join combined_reports r on r.candidacy_id=c.id where c.drive_id=$1 and r.status='ready' limit 2", [a.drive_id]);
  if (sameDrive.rows.length >= 2) {
    const cmp = await admin.req("GET", `/app/drives/${a.drive_id}/compare?ids=${sameDrive.rows[0].id}&ids=${sameDrive.rows[1].id}`);
    check(cmp.status === 200 && cmp.text.includes("Compare candidates") && cmp.text.includes("Final score"), "comparison page renders");
  }

  // Print / PDF export
  const pr = await admin.req("GET", `/print/candidates/${a.id}?masked=1`);
  check(pr.status === 200 && pr.text.includes("HBE Interview report") && pr.text.includes(`Candidate ${a.id.slice(0, 6).toUpperCase()}`), "masked print report renders");

  // Share links: plain, passcode, revoke
  const s1 = await admin.json<{ url: string; id: string }>("POST", `/api/candidacies/${a.id}/share`, { days: 1, masked: true });
  const anon = new Client();
  const v1 = await anon.req("GET", new URL(s1.url).pathname);
  check(v1.status === 200 && v1.text.includes("Shared read-only report"), "share link opens without login");
  const s2 = await admin.json<{ url: string }>("POST", `/api/candidacies/${a.id}/share`, { days: 1, masked: false, passcode: "s3cret" });
  const path2 = new URL(s2.url).pathname;
  const locked = await anon.req("GET", path2);
  check(locked.text.includes("This report is protected"), "passcode-protected link asks for passcode");
  const bad = await anon.req("POST", `/api${path2}/unlock`, { passcode: "nope" });
  check(bad.status === 401, "wrong passcode rejected");
  const ok = await anon.req("POST", `/api${path2}/unlock`, { passcode: "s3cret" });
  check(ok.status === 200, "correct passcode accepted");
  const unlocked = await anon.req("GET", path2);
  check(unlocked.text.includes("Shared read-only report"), "unlocked link shows report");
  await admin.json("DELETE", `/api/share/${s1.id}`);
  const revoked = await anon.req("GET", new URL(s1.url).pathname);
  check(revoked.text.includes("invalid, expired or has been revoked"), "revoked link no longer works");

  // Custom coding problems: valid and invalid reference solutions
  const statement = "Read two integers a and b from one line and print their sum.";
  const tests = { samples: [{ input: "1 2\n", output: "3" }], hidden: [{ input: "5 7\n", output: "12" }, { input: "-1 1\n", output: "0" }, { input: "100 250\n", output: "350" }] };
  const good = await admin.json<{ validation: { ok: boolean } }>("POST", `/api/drives/${a.drive_id}/problems`, {
    title: "Sum two numbers", difficulty: "easy", statement, ...tests, referenceLanguage: "python", referenceCode: "a, b = map(int, input().split())\nprint(a + b)\n",
  });
  check(good.validation.ok, "custom problem with correct reference solution validates");
  const wrong = await admin.json<{ validation: { ok: boolean } }>("POST", `/api/drives/${a.drive_id}/problems`, {
    title: "Broken problem", difficulty: "easy", statement, ...tests, referenceLanguage: "python", referenceCode: "a, b = map(int, input().split())\nprint(a - b)\n",
  });
  check(!wrong.validation.ok, "custom problem with wrong reference solution is rejected");

  // Hiring manager drive scoping
  const email = `hm.${Date.now()}@hbe.local`;
  const { id: hmId } = await admin.json<{ id: string }>("POST", "/api/settings/users", { name: "Hiring Manager", email, password: "manager123", role: "hiring_manager" });
  const hm = new Client();
  await hm.json("POST", "/api/auth/login", { email, password: "manager123" });
  const denied = await hm.req("GET", `/app/candidates/${a.id}`);
  check(denied.status === 404 || denied.text.includes("not found") || denied.text.includes("NEXT_HTTP_ERROR_FALLBACK;404"), "unassigned hiring manager cannot open the candidate");
  const deniedApi = await hm.req("POST", `/api/candidacies/${a.id}/notes`, { text: "hello" });
  check(deniedApi.status === 403, "unassigned hiring manager API call is forbidden");
  await admin.json("PUT", `/api/settings/users/${hmId}`, { driveIds: [a.drive_id] });
  const allowed = await hm.req("POST", `/api/candidacies/${a.id}/notes`, { text: "Looks strong on system design." });
  check(allowed.status === 200, "assigned hiring manager can add a note");
  void b;

  await db.end();
  console.log("\nPHASE 2 CHECKS PASSED");
}

main().catch((e) => {
  console.error("\nPHASE 2 CHECKS FAILED:", e.message ?? e);
  process.exit(1);
});
