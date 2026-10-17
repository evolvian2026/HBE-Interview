/**
 * Phase 6 checks: verified domains, OpenID Connect single sign-on (against a local mock identity provider, including
 * forged/tampered responses) and per-organisation branding.
 *   BASE_URL=http://localhost:3000 npx tsx scripts/smoke-phase6.ts
 */
import "./load-env";
import pg from "pg";
import { startMockIdp, type Tamper } from "./mock-oidc";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
let passed = 0;
function check(cond: unknown, msg: string) {
  if (!cond) throw new Error(`CHECK FAILED: ${msg}`);
  passed++;
  console.log("✓", msg);
}

class Client {
  cookies = new Map<string, string>();
  async req(method: string, url: string, body?: unknown, extra: Record<string, string> = {}) {
    const full = url.startsWith("http") ? url : BASE + url;
    const sameApp = full.startsWith(BASE);
    const res = await fetch(full, {
      method,
      redirect: "manual",
      headers: {
        ...(sameApp && this.cookies.size ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...extra,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (sameApp)
      for (const sc of res.headers.getSetCookie()) {
        const [kv] = sc.split(";");
        const i = kv.indexOf("=");
        const k = kv.slice(0, i);
        const v = kv.slice(i + 1);
        if (!v || /max-age=0|expires=thu, 01 jan 1970/i.test(sc)) this.cookies.delete(k);
        else this.cookies.set(k, v);
      }
    return { status: res.status, text: await res.text(), location: res.headers.get("location") ?? "" };
  }
  async json<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await this.req(method, path, body);
    if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status}: ${r.text}`);
    return JSON.parse(r.text || "{}") as T;
  }
  login(email: string, password: string) {
    return this.req("POST", "/api/auth/login", { email, password });
  }
  /** Follow redirects (app ↔ identity provider) and return the final app location. */
  async follow(startPath: string, max = 6): Promise<{ location: string; hops: string[] }> {
    let next = startPath;
    const hops: string[] = [];
    for (let i = 0; i < max; i++) {
      const r = await this.req("GET", next);
      if (r.status < 300 || r.status >= 400) return { location: next, hops };
      next = new URL(r.location, next.startsWith("http") ? next : BASE).toString();
      hops.push(next);
      if (next.startsWith(BASE) && !next.includes("/api/auth/sso/")) return { location: next, hops };
    }
    return { location: next, hops };
  }
  /** SSO sign-in by email through the mock IdP; returns where the app sent us. */
  sso(email: string) {
    return this.follow(`/api/auth/sso/start?email=${encodeURIComponent(email)}`);
  }
}

async function main() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const q = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows as T[];
  // This script starts ~60 SSO flows; clear the per-IP window so back-to-back runs don't trip the limit.
  await q("delete from rate_limits where key like 'sso-start:%'");
  const stamp = Date.now();
  const domain = `acme-${stamp}.com`;
  const idp = await startMockIdp(4610);

  const platform = new Client();
  check((await platform.login(process.env.ADMIN_EMAIL!, process.env.ADMIN_PASSWORD!)).status === 200, "platform admin signs in");
  const adminEmail = `admin@${domain}`;
  const adminPw = "Granite-Falcon-38";
  const org = await platform.json<{ id: string }>("POST", "/api/platform/orgs", { name: `Acme SSO ${stamp}`, admin: { name: "Asha Admin", email: adminEmail, password: adminPw } });
  const admin = new Client();
  await admin.login(adminEmail, adminPw);

  /* --------------------------------- domains --------------------------------- */
  check((await admin.req("POST", "/api/settings/domains", { domain: "gmail.com" })).status === 400, "public email domains can't be claimed");
  check((await admin.req("POST", "/api/settings/domains", { domain: "not a domain" })).status === 400, "invalid domains are rejected");
  const dom = await admin.json<{ id: string; txt: string }>("POST", "/api/settings/domains", { domain: `@${domain.toUpperCase()}` });
  check(dom.txt.startsWith("hbe-verification="), "domain claimed with a DNS TXT verification value");
  check((await platform.req("POST", "/api/settings/domains", { domain })).status === 409, "another organisation can't claim the same domain");
  const dns = await admin.req("POST", `/api/settings/domains/${dom.id}/verify`);
  check(dns.status === 400 && dns.text.includes("TXT record not found"), "verification fails until the TXT record exists");
  await admin.json("PUT", "/api/settings/sso", { issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, enabled: false, required: false, jitRole: null });
  const early = await admin.req("PUT", "/api/settings/sso", { issuer: idp.issuer, clientId: idp.clientId, enabled: true, required: false, jitRole: null });
  check(early.status === 400 && early.text.includes("Verify at least one email domain"), "SSO can't be turned on without a verified domain");
  check((await admin.req("POST", `/api/platform/domains/${dom.id}`)).status === 403, "organisation admins can't self-confirm a domain");
  await platform.json("POST", `/api/platform/domains/${dom.id}`);
  const [cfgRow] = await q<{ client_secret: string }>("select client_secret from sso_configs where org_id = $1", [org.id]);
  check(cfgRow.client_secret.startsWith("v1.") && !cfgRow.client_secret.includes(idp.clientSecret), "client secret is stored encrypted");
  const wrongIssuer = await admin.req("PUT", "/api/settings/sso", { issuer: "http://127.0.0.1:4699", clientId: idp.clientId, enabled: true, required: false, jitRole: null });
  check(wrongIssuer.status === 400 && wrongIssuer.text.includes("Couldn't reach"), "an unreachable issuer is rejected on save");
  await admin.json("PUT", "/api/settings/sso", { issuer: idp.issuer, clientId: idp.clientId, enabled: true, required: false, jitRole: null });
  const req1 = await admin.req("PUT", "/api/settings/sso", { issuer: idp.issuer, clientId: idp.clientId, enabled: true, required: true, jitRole: null });
  check(req1.status === 400 && req1.text.includes("Test sign-in"), "SSO can't be required before a successful test");

  /* --------------------------------- test sign-in --------------------------------- */
  idp.users.set(adminEmail, "Asha Admin");
  const t = await admin.follow(`/api/auth/sso/start?test=1&email=${encodeURIComponent(adminEmail)}`);
  check(t.location.includes(`/app/settings?sso_test=${encodeURIComponent(adminEmail)}`), "test sign-in round-trips through the identity provider");
  check(t.hops.some((h) => h.startsWith(idp.issuer + "/authorize") && h.includes("code_challenge_method=S256") && h.includes("nonce=")), "authorization request uses PKCE (S256), state and nonce");
  check((await q("select 1 from sso_configs where org_id = $1 and last_tested_at is not null", [org.id])).length === 1, "successful test is recorded");

  /* --------------------------------- sign-in --------------------------------- */
  const samEmail = `sam@${domain}`;
  await admin.json("POST", "/api/settings/users", { name: "Sam Recruiter", email: samEmail, password: "Quiet-Meadow-51", role: "recruiter" });
  idp.users.set(samEmail, "Sam Recruiter");
  const sam = new Client();
  const r1 = await sam.sso(samEmail);
  check(r1.location === `${BASE}/app` && (await sam.req("GET", "/app")).status === 200, "existing user signs in with SSO");
  check((await q("select 1 from audit_log where action = 'auth.sso_login' and org_id = $1", [org.id])).length >= 1, "SSO sign-in is audited");
  const newbie = `newbie@${domain}`;
  idp.users.set(newbie, "New Person");
  const noJit = await new Client().sso(newbie);
  check(noJit.location.includes("/login?sso_error=") && decodeURIComponent(noJit.location).includes("don't have an account"), "unknown people are refused while automatic accounts are off");
  await admin.json("PUT", "/api/settings/sso", { issuer: idp.issuer, clientId: idp.clientId, enabled: true, required: false, jitRole: "viewer" });
  const jitClient = new Client();
  const jit = await jitClient.sso(newbie);
  const [jitUser] = await q<{ role: string; org_id: string }>("select role, org_id from users where email = $1", [newbie]);
  check(jit.location === `${BASE}/app` && jitUser?.role === "viewer" && jitUser.org_id === org.id, "just-in-time provisioning creates a Viewer in the right organisation");
  const outsider = `someone@other-${stamp}.com`;
  idp.users.set(outsider, "Outsider");
  const outsiderStart = await new Client().req("GET", `/api/auth/sso/start?email=${encodeURIComponent(outsider)}`);
  check(outsiderStart.status === 303 && outsiderStart.location.includes("sso_error"), "emails outside verified domains aren't routed to SSO");

  /* ------------------------------- forged responses ------------------------------- */
  const tampers: [Tamper, string][] = [
    ["aud", "audience"],
    ["iss", "issuer"],
    ["nonce", "nonce"],
    ["expired", "expiry"],
    ["unverified", "email verification flag"],
    ["foreign-key", "signature"],
    ["no-email", "email"],
  ];
  for (const [tamper, what] of tampers) {
    idp.tamper = tamper;
    const c = new Client();
    const r = await c.sso(samEmail);
    check(r.location.includes("/login?sso_error=") && (await c.req("GET", "/app")).status === 307, `ID token with a bad ${what} is rejected (${tamper})`);
  }
  idp.tamper = "none";
  // State mismatch: tamper with the callback URL.
  const s1 = new Client();
  const start = await s1.req("GET", `/api/auth/sso/start?email=${encodeURIComponent(samEmail)}`);
  const auth = await s1.req("GET", start.location);
  const cb = new URL(auth.location);
  cb.searchParams.set("state", "forged");
  const forged = await s1.req("GET", cb.toString());
  check(forged.location.includes("sso_error") && (await s1.req("GET", "/app")).status === 307, "a callback with a forged state is rejected");
  // Callback replay and login CSRF: the state cookie is single-use and bound to the browser that started.
  const s2 = new Client();
  const st2 = await s2.req("GET", `/api/auth/sso/start?email=${encodeURIComponent(samEmail)}`);
  const auth2 = await s2.req("GET", st2.location);
  const victim = new Client();
  const csrf = await victim.req("GET", auth2.location);
  check(csrf.location.includes("sso_error") && (await victim.req("GET", "/app")).status === 307, "a callback opened in another browser (login CSRF) is rejected");
  const ok2 = await s2.req("GET", auth2.location);
  check(ok2.location.endsWith("/app") || ok2.location === "/app" || ok2.location === `${BASE}/app`, "the original browser can complete its own sign-in");
  const replay = await s2.req("GET", auth2.location);
  check(replay.location.includes("sso_error"), "a callback can't be replayed");
  // Identity provider error.
  const denied = await new Client().sso(`ghost@${domain}`);
  check(decodeURIComponent(denied.location).includes("refused the sign-in"), "identity-provider errors are shown on the login page");

  /* ------------------------------ cross-organisation ------------------------------ */
  // A user in another organisation whose email is in this organisation's domain can't be taken over through SSO.
  const crossEmail = `cross@${domain}`;
  await platform.json("POST", "/api/settings/users", { name: "Cross Person", email: crossEmail, password: "Velvet-Comet-26", role: "viewer" });
  idp.users.set(crossEmail, "Cross Person");
  const cross = await new Client().sso(crossEmail);
  check(decodeURIComponent(cross.location).includes("another organisation"), "SSO can't sign into an account that belongs to another organisation");

  /* ------------------------------- SSO required ------------------------------- */
  await admin.json("PUT", "/api/settings/sso", { issuer: idp.issuer, clientId: idp.clientId, enabled: true, required: true, jitRole: "viewer" });
  const pw = await new Client().login(samEmail, "Quiet-Meadow-51");
  check(pw.status === 409 && pw.text.includes("single sign-on"), "password sign-in is refused when SSO is required");
  const wrongPw = await new Client().login(samEmail, "not-the-password-1");
  check(wrongPw.status === 401, "a wrong password still says 'invalid' (SSO status isn't revealed before the password is checked)");
  check((await new Client().login(process.env.ADMIN_EMAIL!, process.env.ADMIN_PASSWORD!)).status === 200, "platform admins keep password access (break-glass)");
  // Organisation requires 2FA: SSO sessions satisfy it (MFA is the identity provider's job); password users still enrol.
  const adminSso = new Client();
  await adminSso.sso(adminEmail);
  check((await adminSso.req("PUT", "/api/settings", { require2fa: true })).status === 200, "an SSO-signed-in admin can require 2FA");
  const samAgain = new Client();
  await samAgain.sso(samEmail);
  check((await samAgain.req("GET", "/app")).status === 200, "SSO users aren't asked to enrol in app 2FA");
  // Deactivated users can't come back through SSO.
  const [{ id: samId }] = await q<{ id: string }>("select id from users where email = $1", [samEmail]);
  await adminSso.json("PUT", `/api/settings/users/${samId}`, { active: false });
  check((await samAgain.req("GET", "/app")).status === 307, "deactivating a user ends their SSO session");
  const deact = await new Client().sso(samEmail);
  check(decodeURIComponent(deact.location).includes("deactivated"), "deactivated users can't sign in with SSO");
  // Suspended organisations: SSO routing stops.
  await platform.json("PUT", `/api/platform/orgs/${org.id}`, { status: "suspended" });
  const susp = await new Client().req("GET", `/api/auth/sso/start?email=${encodeURIComponent(adminEmail)}`);
  check(susp.location.includes("sso_error"), "a suspended organisation's SSO is unavailable");
  await platform.json("PUT", `/api/platform/orgs/${org.id}`, { status: "active" });

  const loginPage = await new Client().req("GET", "/login");
  check(loginPage.text.includes("Sign in with single sign-on"), "login page offers single sign-on");
  const settings = await adminSso.req("GET", "/app/settings");
  check(settings.status === 200 && settings.text.includes("Single sign-on") && settings.text.includes("/api/auth/sso/callback") && !settings.text.includes(idp.clientSecret), "settings show SSO without revealing the client secret");

  /* --------------------------- DNS verification (success) --------------------------- */
  const second = await adminSso.json<{ id: string; txt: string }>("POST", "/api/settings/domains", { domain: `jobs.${domain}` });
  const { verifyDomainDns } = await import("../src/lib/services/sso");
  const actor = { id: "00000000-0000-0000-0000-000000000000", orgId: org.id } as never;
  await verifyDomainDns(org.id, second.id, actor, async () => [["unrelated=1"], [second.txt]]);
  check((await q("select 1 from org_domains where id = $1 and verified_by = 'dns' and verified_at is not null", [second.id])).length === 1, "a domain with the right TXT record verifies via DNS");

  /* ---------------------------------- branding ---------------------------------- */
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  const upload = async (bytes: Buffer, name: string, type: string) => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)], { type }), name);
    const res = await fetch(`${BASE}/api/settings/branding/logo`, { method: "POST", headers: { cookie: [...adminSso.cookies].map(([k, v]) => `${k}=${v}`).join("; ") }, body: form });
    return res.status;
  };
  check((await upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), "logo.svg", "image/svg+xml")) === 400, "SVG logos are refused (they can carry scripts)");
  check((await upload(Buffer.from("GIF89a fake"), "logo.png", "image/png")) === 400, "files are checked by content, not by name or declared type");
  check((await upload(Buffer.alloc(210 * 1024, 1), "big.png", "image/png")) === 400, "logos over 200 KB are refused");
  check((await upload(PNG, "logo.png", "image/png")) === 201, "PNG logo uploaded");
  const light = await adminSso.req("PUT", "/api/settings/branding", { brandColor: "#ffd166" });
  check(light.status === 400 && light.text.includes("too light"), "a brand colour too light for white text is refused");
  check((await adminSso.req("PUT", "/api/settings/branding", { brandColor: "#0f766e" })).status === 200, "a readable brand colour is accepted");
  const jdB = `We are hiring a Platform Engineer to build Kubernetes-based infrastructure, CI/CD pipelines and observability for our product teams. Requirements: 4+ years with Linux, Terraform, AWS, Go or Python, incident response and on-call experience.`;
  const { id: driveB } = await adminSso.json<{ id: string }>("POST", "/api/drives", { title: "Platform Engineer", jdText: jdB });
  await adminSso.json("POST", `/api/drives/${driveB}/publish`, {});
  const invB = await adminSso.json<{ results: { link: string }[] }>("POST", `/api/drives/${driveB}/invites`, { candidates: [{ name: "Brand Candidate", email: `brand.${stamp}@example.com` }] });
  const hubHtml = (await new Client().req("GET", `/c/${invB.results[0].link.split("/c/")[1]}`)).text;
  const logoPath = /\/api\/public\/orgs\/[0-9a-f-]+\/logo\?v=[0-9a-f]+/.exec(hubHtml)?.[0];
  check(!!logoPath && hubHtml.includes("--color-brand-600:#0f766e") && hubHtml.includes("Interview powered by HBE Interview"), "candidate hub shows the organisation's logo and colour");
  const logoRes = await fetch(BASE + logoPath!);
  check(logoRes.status === 200 && logoRes.headers.get("content-type") === "image/png" && logoRes.headers.get("x-content-type-options") === "nosniff" && (logoRes.headers.get("cache-control") ?? "").includes("immutable"), "logo is served as a cached PNG with nosniff");
  const [{ open_slug }] = await q<{ open_slug: string }>("select open_slug from drives where id = $1", [driveB]);
  check((await new Client().req("GET", `/i/${open_slug}`)).text.includes("--color-brand-600:#0f766e"), "open application page is branded too");
  const [other] = await q<{ access_token: string }>("select c.access_token from candidacies c where c.org_id <> $1 order by c.created_at desc limit 1", [org.id]);
  const otherHub = (await new Client().req("GET", `/c/${other.access_token}`)).text;
  check(!otherHub.includes("#0f766e") && !otherHub.includes(`/api/public/orgs/${org.id}/logo`), "other organisations' candidates don't see this branding");

  await idp.close();
  await db.end();
  console.log(`\nPHASE 6 CHECKS PASSED (${passed} checks)\norg: ${org.id}\nORG_ADMIN_EMAIL=${adminEmail}`);
}

main().catch((e) => {
  console.error("\nPHASE 6 CHECKS FAILED:", e);
  process.exit(1);
});
