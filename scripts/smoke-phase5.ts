/**
 * Phase 5 checks: security hardening, two-factor sign-in, audit log, candidate data rights, operations.
 *   BASE_URL=http://localhost:3000 npx tsx scripts/smoke-phase5.ts
 * Works in a fresh organisation it creates, so the platform admin account is never locked out.
 */
import "./load-env";
import pg from "pg";
import { base32Decode, totp } from "../src/lib/core/totp";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
let passed = 0;
function check(cond: unknown, msg: string) {
  if (!cond) throw new Error(`CHECK FAILED: ${msg}`);
  passed++;
  console.log("✓", msg);
}

class Client {
  cookies = new Map<string, string>();
  async req(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
    const res = await fetch(BASE + path, {
      method,
      redirect: "manual",
      headers: {
        ...(this.cookies.size ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...extra,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const sc of res.headers.getSetCookie()) {
      const [kv] = sc.split(";");
      const i = kv.indexOf("=");
      const k = kv.slice(0, i);
      const v = kv.slice(i + 1);
      if (!v || /max-age=0|expires=thu, 01 jan 1970/i.test(sc)) this.cookies.delete(k);
      else this.cookies.set(k, v);
    }
    return { status: res.status, text: await res.text(), headers: res.headers };
  }
  async json<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await this.req(method, path, body);
    if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status}: ${r.text}`);
    return JSON.parse(r.text || "{}") as T;
  }
  login(email: string, password: string) {
    return this.req("POST", "/api/auth/login", { email, password });
  }
}

/** A TOTP code for a step that hasn't been used yet (codes can't be replayed within their 30-second window). */
async function freshCode(secret: string, after?: number) {
  for (;;) {
    const step = Math.floor(Date.now() / 30_000);
    if (after === undefined || step > after) return { code: totp(base32Decode(secret)), step };
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function main() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const q = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows as T[];
  const stamp = Date.now();
  const platform = new Client();
  check((await platform.login(process.env.ADMIN_EMAIL!, process.env.ADMIN_PASSWORD!)).status === 200, "platform admin signs in");

  /* ------------------------------ headers ------------------------------ */
  const login = await new Client().req("GET", "/login");
  const csp = login.headers.get("content-security-policy") ?? "";
  check(csp.includes("frame-ancestors 'none'") && csp.includes("object-src 'none'") && csp.includes("default-src 'self'"), "Content-Security-Policy is set");
  check(login.headers.get("x-frame-options") === "DENY" && login.headers.get("x-content-type-options") === "nosniff", "clickjacking and MIME-sniffing headers are set");
  check(login.headers.get("referrer-policy") === "strict-origin-when-cross-origin" && !login.headers.get("x-powered-by"), "referrer policy set, framework banner removed");

  /* --------------------------- organisation C --------------------------- */
  const weak = await platform.req("POST", "/api/platform/orgs", { name: `Sec ${stamp}`, admin: { name: "Chitra Admin", email: `chitra.${stamp}@sec.test`, password: "password" } });
  check(weak.status === 400 && weak.text.includes("password"), "weak first-admin password is rejected");
  const adminPw = "Correct-Horse-91";
  const org = await platform.json<{ id: string }>("POST", "/api/platform/orgs", { name: `Sec ${stamp}`, admin: { name: "Chitra Admin", email: `chitra.${stamp}@sec.test`, password: adminPw } });
  const admin = new Client();
  check((await admin.login(`chitra.${stamp}@sec.test`, adminPw)).status === 200, "organisation admin signs in");
  for (const [pw, why] of [["short1!", "too short"], ["umaumauma-recruiter", "contains the name"], ["lowercaseonly", "one character class and under 16 characters"]] as const) {
    const r = await admin.req("POST", "/api/settings/users", { name: "Uma Recruiter", email: `uma.${stamp}@sec.test`, password: pw, role: "recruiter" });
    check(r.status === 400, `password policy rejects a password that ${why === "too short" ? "is too short" : why === "contains the name" ? "contains the name" : "has " + why}`);
  }
  const umaPw = "Blue-Kettle-44";
  const { id: umaId } = await admin.json<{ id: string }>("POST", "/api/settings/users", { name: "Uma Recruiter", email: `uma.${stamp}@sec.test`, password: umaPw, role: "recruiter" });

  /* ------------------------------- CSRF ------------------------------- */
  const forged = await admin.req("POST", "/api/drives", { title: "Forged", jdText: "x".repeat(300) }, { origin: "https://evil.example" });
  check(forged.status === 403 && forged.text.includes("Cross-site"), "request with a foreign Origin is blocked");
  const sameOrigin = await admin.req("GET", "/api/audit/export?days=1", undefined, { origin: BASE });
  check(sameOrigin.status === 200, "same-origin request is allowed");

  /* ------------------------------ lockout ------------------------------ */
  const uma = new Client();
  for (let i = 0; i < 5; i++) await uma.login(`uma.${stamp}@sec.test`, "wrong-password-1");
  const locked = await uma.login(`uma.${stamp}@sec.test`, umaPw);
  check(locked.status === 429, "account locks after 5 wrong passwords (even the right password is refused)");
  check((await q("select 1 from audit_log where action = 'auth.locked' and entity_id = $1", [umaId])).length === 1, "lockout is audited");
  await db.query("update users set locked_until = now() - interval '1 second' where id = $1", [umaId]);
  await db.query("delete from rate_limits where key = $1", [`login:email:uma.${stamp}@sec.test`]);
  check((await uma.login(`uma.${stamp}@sec.test`, umaPw)).status === 200, "after the lock expires the right password works");

  /* ------------------------- session revocation ------------------------- */
  const uma2 = new Client();
  await uma2.login(`uma.${stamp}@sec.test`, umaPw);
  check((await uma2.req("GET", "/app")).status === 200, "second session works");
  const newPw = "Green-Teapot-58";
  await uma.json("POST", "/api/auth/password", { current: umaPw, next: newPw });
  check((await uma.req("GET", "/app")).status === 200, "password change keeps the current session");
  const revoked = await uma2.req("GET", "/app");
  check(revoked.status === 307 && (revoked.headers.get("location") ?? "").includes("/login"), "password change signs out other sessions");
  check((await uma2.req("POST", "/api/drives", { title: "x", jdText: "y" })).status === 401, "revoked session can't call APIs");
  await uma.json("DELETE", "/api/auth/sessions");
  check((await uma.req("GET", "/app")).status === 307, "sign out everywhere ends this session too");
  await uma.login(`uma.${stamp}@sec.test`, newPw);

  /* --------------------------- two-factor --------------------------- */
  const setup = await uma.json<{ secret: string; qr: string; uri: string }>("POST", "/api/auth/2fa/setup");
  check(setup.qr.startsWith("data:image/png;base64,") && setup.uri.startsWith("otpauth://totp/") && setup.secret.length >= 32, "2FA setup returns a QR code and secret");
  const [stored] = await q<{ totp_secret: string }>("select totp_secret from users where id = $1", [umaId]);
  check(stored.totp_secret.startsWith("v1.") && !stored.totp_secret.includes(setup.secret), "TOTP secret is stored encrypted");
  check((await uma.req("POST", "/api/auth/2fa/enable", { code: "000000" })).status === 400, "wrong code doesn't enable 2FA");
  let c = await freshCode(setup.secret);
  const { recoveryCodes } = await uma.json<{ recoveryCodes: string[] }>("POST", "/api/auth/2fa/enable", { code: c.code });
  check(recoveryCodes.length === 10 && recoveryCodes.every((x) => /^[A-Z2-7]{4}-[A-Z2-7]{4}$/.test(x)), "2FA enabled with 10 recovery codes");
  const s2 = new Client();
  const pwOnly = await s2.login(`uma.${stamp}@sec.test`, newPw);
  check(pwOnly.status === 200 && JSON.parse(pwOnly.text).twoFactor === true, "password alone now asks for a second factor");
  check((await s2.req("GET", "/app")).status === 307, "no session is issued before the second factor");
  check((await s2.req("POST", "/api/auth/2fa", { code: "123456" })).status === 401, "wrong TOTP code is refused");
  check((await s2.req("POST", "/api/auth/2fa", { code: c.code })).status === 401, "a code can't be replayed in its window");
  c = await freshCode(setup.secret, c.step);
  check((await s2.req("POST", "/api/auth/2fa", { code: c.code })).status === 200 && (await s2.req("GET", "/app")).status === 200, "correct TOTP code completes sign-in");
  const s3 = new Client();
  await s3.login(`uma.${stamp}@sec.test`, newPw);
  const rec = await s3.req("POST", "/api/auth/2fa", { code: recoveryCodes[0].toLowerCase() });
  check(rec.status === 200 && JSON.parse(rec.text).recoveryCodesLeft === 9, "a recovery code works once (case-insensitive)");
  const s4 = new Client();
  await s4.login(`uma.${stamp}@sec.test`, newPw);
  check((await s4.req("POST", "/api/auth/2fa", { code: recoveryCodes[0] })).status === 401, "a used recovery code is refused");
  check((await new Client().req("POST", "/api/auth/2fa", { code: "123456" })).status === 401, "the 2FA step needs a password challenge first");

  /* ----------------------- organisation requires 2FA ----------------------- */
  const req2fa = await admin.req("PUT", "/api/settings", { require2fa: true });
  check(req2fa.status === 400 && req2fa.text.includes("your own account first"), "admin can't require 2FA before turning it on for themselves");
  const aSetup = await admin.json<{ secret: string }>("POST", "/api/auth/2fa/setup");
  await admin.json("POST", "/api/auth/2fa/enable", { code: (await freshCode(aSetup.secret)).code });
  await admin.json("PUT", "/api/settings", { require2fa: true });
  const vPw = "Silver-Lantern-73";
  await admin.json("POST", "/api/settings/users", { name: "Vik Viewer", email: `vik.${stamp}@sec.test`, password: vPw, role: "viewer" });
  const vik = new Client();
  await vik.login(`vik.${stamp}@sec.test`, vPw);
  const forcedPage = await vik.req("GET", "/app");
  check(forcedPage.status === 307 && (forcedPage.headers.get("location") ?? "").includes("/app/security?enroll=1"), "staff without 2FA are sent to set it up");
  const forcedApi = await vik.req("GET", "/api/audit/export");
  check(forcedApi.status === 403 && forcedApi.text.includes("two-factor"), "APIs are blocked until 2FA is set up");
  check((await vik.req("GET", "/app/security")).status === 200, "the security page stays reachable for enrolment");
  const vSetup = await vik.json<{ secret: string }>("POST", "/api/auth/2fa/setup");
  await vik.json("POST", "/api/auth/2fa/enable", { code: (await freshCode(vSetup.secret)).code });
  check((await vik.req("GET", "/app")).status === 200, "after enrolling, the app opens");
  check((await vik.req("POST", "/api/auth/2fa/disable", { password: vPw })).status === 400, "2FA can't be turned off while the organisation requires it");
  // Admin resets Uma's 2FA (lost phone): her sessions end and she must enrol again.
  await admin.json("PUT", `/api/settings/users/${umaId}`, { reset2fa: true });
  check((await s2.req("GET", "/app")).status === 307, "resetting a user's 2FA signs them out");
  const after = new Client();
  const afterLogin = await after.login(`uma.${stamp}@sec.test`, newPw);
  check(afterLogin.status === 200 && !JSON.parse(afterLogin.text).twoFactor && ((await after.req("GET", "/app")).headers.get("location") ?? "").includes("enroll=1"), "after a reset the user signs in with password and must enrol again");

  /* ---------------------------- data rights ---------------------------- */
  const jd = `We are hiring a Backend Engineer for our security platform. You will build Go and Python services with PostgreSQL on AWS, design APIs, write tests and own reliability. Requirements: 3-5 years of backend experience, SQL, testing and CI/CD.`;
  const { id: driveId } = await admin.json<{ id: string }>("POST", "/api/drives", { title: "Security Backend Engineer", jdText: jd });
  await admin.json("POST", `/api/drives/${driveId}/publish`, {});
  const inv = await admin.json<{ results: { link: string; candidacyId: string }[] }>("POST", `/api/drives/${driveId}/invites`, {
    candidates: [
      { name: "Dev Deletes", email: `dev.${stamp}@example.com` },
      { name: "Ira Overdue", email: `ira.${stamp}@example.com` },
    ],
  });
  const [dev, ira] = inv.results.map((r) => ({ token: r.link.split("/c/")[1], id: r.candidacyId }));
  const cand = new Client();
  await cand.json("POST", `/api/c/${dev.token}/consent`, { accept: true });
  await cand.json("POST", `/api/c/${ira.token}/consent`, { accept: true });
  const exp = await cand.req("GET", `/api/c/${dev.token}/data`);
  const data = JSON.parse(exp.text);
  check(exp.status === 200 && (exp.headers.get("content-disposition") ?? "").includes("attachment") && data.you.email === `dev.${stamp}@example.com` && data.application.consent, "candidate downloads their data (JSON attachment)");
  check(!JSON.stringify(data).includes("roundScore") && !JSON.stringify(data).includes("passwordHash"), "export excludes internal scores and staff data");
  const hub = await cand.req("GET", `/c/${dev.token}`);
  check(hub.text.includes("Your data") && hub.text.includes("Download my data"), "candidate hub shows the data-rights section");
  const del = await cand.json<{ id: string; dueAt: string }>("POST", `/api/c/${dev.token}/deletion`, { reason: "I accepted another offer" });
  const dueDays = (new Date(del.dueAt).getTime() - Date.now()) / 86_400_000;
  check(dueDays > 29 && dueDays <= 30, "deletion request is due in 30 days");
  check((await cand.json<{ id: string }>("POST", `/api/c/${dev.token}/deletion`, {})).id === del.id, "repeat requests don't duplicate");
  check((await cand.req("GET", `/c/${dev.token}`)).text.includes("You asked for your data to be deleted"), "candidate sees the pending request");
  const appPage = await admin.req("GET", "/app");
  check(appPage.text.includes("data deletion request"), "admins see a banner for pending requests");
  const reqPage = await admin.req("GET", "/app/data-requests");
  check(reqPage.text.includes(`dev.${stamp}@example.com`) && reqPage.text.includes("I accepted another offer"), "data requests page lists it with the reason");
  check((await admin.req("POST", `/api/data-requests/${del.id}`, { action: "decline", reason: "short" })).status === 400, "declining needs a real reason");
  check((await platform.req("POST", `/api/data-requests/${del.id}`, { action: "delete" })).status === 404, "another organisation can't action the request");
  await admin.json("POST", `/api/data-requests/${del.id}`, { action: "delete" });
  check((await q("select 1 from candidacies where id = $1", [dev.id])).length === 0, "deleting removes the candidacy and its data");
  check((await cand.req("GET", `/c/${dev.token}`)).text.includes("This link is not valid"), "the candidate's link stops working");
  const [doneReq] = await q<{ status: string; candidate_email: string }>("select status, candidate_email from data_requests where id = $1", [del.id]);
  check(doneReq.status === "completed" && doneReq.candidate_email === `dev.${stamp}@example.com`, "request is closed and kept as proof");
  // Overdue requests are fulfilled automatically.
  const late = await cand.json<{ id: string }>("POST", `/api/c/${ira.token}/deletion`, {});
  await db.query("update data_requests set due_at = now() - interval '1 minute' where id = $1", [late.id]);
  const { fulfilOverdueDeletions } = await import("../src/lib/services/data-rights");
  await fulfilOverdueDeletions();
  const [lateRow] = await q<{ status: string; resolution: string }>("select status, resolution from data_requests where id = $1", [late.id]);
  check(lateRow.status === "completed" && lateRow.resolution.includes("automatically") && (await q("select 1 from candidacies where id = $1", [ira.id])).length === 0, "overdue requests are fulfilled automatically");

  /* ------------------------------ audit log ------------------------------ */
  const auditPage = await admin.req("GET", "/app/audit?category=auth&days=1");
  check(auditPage.status === 200 && auditPage.text.includes("auth.login") && auditPage.text.includes("auth.2fa_enabled") && !auditPage.text.includes("drive.publish"), "audit log filters by category");
  const dataAudit = await admin.req("GET", "/app/audit?category=data&days=1");
  check(dataAudit.text.includes("data.deletion_requested") && dataAudit.text.includes("data.deletion_completed") && dataAudit.text.includes("data.export"), "data-rights actions are audited");
  // A staff name that looks like a spreadsheet formula ends up in the CSV's actor column.
  const evilPw = "Orange-Bicycle-62";
  await admin.json("POST", "/api/settings/users", { name: "=HYPERLINK(1)", email: `evil.${stamp}@sec.test`, password: evilPw, role: "viewer" });
  await new Client().login(`evil.${stamp}@sec.test`, evilPw);
  await admin.json("PUT", `/api/settings/users/${umaId}`, { role: "viewer" });
  const csv = await admin.req("GET", "/api/audit/export?days=1");
  check(csv.status === 200 && (csv.headers.get("content-type") ?? "").includes("text/csv") && csv.text.startsWith("time,actor_type,actor,action"), "audit CSV export works");
  check(csv.text.includes("user.update") && csv.text.includes("sessionsRevoked"), "CSV includes role changes and session revocations");
  check(csv.text.includes(`"'=HYPERLINK(1) <evil.${stamp}@sec.test>"`) && !/(^|,)"=/m.test(csv.text), "CSV cells can't start a spreadsheet formula");
  check(!(await platform.req("GET", "/app/audit?days=1")).text.includes(`chitra.${stamp}`), "another organisation's audit log doesn't show these events");

  /* ------------------------------ operations ------------------------------ */
  const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
  check(health.ok && health.worker.healthy && typeof health.queue.due === "number", "health reports worker heartbeat and queue lag");
  const [j1] = await q<{ id: number }>("insert into jobs (type, payload, status, attempts, max_attempts, last_error) values ('deliver-webhook', '{\"deliveryId\":\"00000000-0000-0000-0000-000000000000\"}', 'failed', 6, 6, 'Webhook delivery failed: test') returning id");
  const [j2] = await q<{ id: number }>("insert into jobs (type, payload, status, attempts, max_attempts, last_error) values ('deliver-webhook', '{\"deliveryId\":\"00000000-0000-0000-0000-000000000001\"}', 'failed', 6, 6, 'Webhook delivery failed: test 2') returning id");
  const ops = await platform.req("GET", "/app/platform/ops");
  check(ops.status === 200 && ops.text.includes("Failed jobs") && ops.text.includes(`#${j1.id}`), "operations page lists failed jobs");
  check((await admin.req("GET", "/app/platform/ops")).status === 404 && (await admin.req("POST", `/api/platform/jobs/${j1.id}`, { action: "retry" })).status === 403, "operations are platform-admin only");
  await platform.json("POST", `/api/platform/jobs/${j1.id}`, { action: "retry" });
  const retried = await (async () => {
    for (let i = 0; i < 30; i++) {
      const [r] = await q<{ status: string }>("select status from jobs where id = $1", [j1.id]);
      if (r.status === "done") return true;
      await new Promise((res) => setTimeout(res, 1000));
    }
    return false;
  })();
  check(retried, "a retried job runs again");
  await platform.json("POST", `/api/platform/jobs/${j2.id}`, { action: "discard" });
  check((await q("select 1 from jobs where id = $1", [j2.id])).length === 0, "a discarded job is removed");

  // Leave the shared platform admin untouched; disable org C's 2FA requirement isn't needed (it's a throwaway org).
  await db.end();
  console.log(`\nPHASE 5 CHECKS PASSED (${passed} checks)\norg: ${org.id}`);
}

main().catch((e) => {
  console.error("\nPHASE 5 CHECKS FAILED:", e);
  process.exit(1);
});
