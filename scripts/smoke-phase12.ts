/**
 * Phase 12 checks: SCIM 2.0 provisioning as Okta and Microsoft Entra ID call it — discovery, token auth, create/filter/
 * page, verified-domain rule, uniqueness, deactivation revoking sessions, role groups, replace, deprovision, platform
 * admins hidden, token rotation/pause, roles and organisation isolation.
 *   BASE_URL=http://localhost:3000 npx tsx scripts/smoke-phase12.ts
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

/** An identity provider talking SCIM with a bearer token. */
function idp(token: string) {
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BASE}/scim/v2${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/scim+json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    return { status: res.status, type: res.headers.get("content-type") ?? "", json: (text ? JSON.parse(text) : {}) as Record<string, any> };
  };
}

async function main() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const q = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows as T[];
  const stamp = Date.now();
  const platform = await new Client().login(process.env.ADMIN_EMAIL!, process.env.ADMIN_PASSWORD!);
  const pw = "Cobalt-Harbour-62";
  const domain = `scim-${stamp}.example.org`;
  const adminEmail = `it-admin@${domain}`;
  const org = await platform.json<{ id: string }>("POST", "/api/platform/orgs", { name: `SCIM Co ${stamp}`, admin: { name: "Ida Admin", email: adminEmail, password: pw } });
  const admin = await new Client().login(adminEmail, pw);
  const dom = await admin.json<{ id: string }>("POST", "/api/settings/domains", { domain });
  await platform.json("POST", `/api/platform/domains/${dom.id}`, {});

  /* --------------------------------- Setup ---------------------------------- */
  const recruiterEmail = `rec@${domain}`;
  await admin.json("POST", "/api/settings/users", { name: "Rex Recruiter", email: recruiterEmail, password: pw, role: "recruiter" });
  const recruiter = await new Client().login(recruiterEmail, pw);
  check((await recruiter.req("POST", "/api/settings/scim", { defaultRole: "viewer" })).status === 403, "only admins can turn on provisioning");
  const { token } = await admin.json<{ token: string }>("POST", "/api/settings/scim", { defaultRole: "recruiter" });
  const [cfg] = await q<{ token_hash: string }>("select token_hash from scim_configs where org_id = $1", [org.id]);
  check(token.startsWith("scim_") && cfg.token_hash !== token && !cfg.token_hash.includes(token.slice(5, 20)), "the token is shown once and stored only as a hash");
  const scim = idp(token);

  /* ------------------------------- Discovery -------------------------------- */
  check((await idp("nope")("GET", "/Users")).status === 401, "requests without a valid token are refused");
  check((await fetch(`${BASE}/scim/v2/Users`)).status === 401, "requests without a token are refused");
  const spc = await scim("GET", "/ServiceProviderConfig");
  check(spc.status === 200 && spc.type.includes("application/scim+json") && spc.json.patch.supported === true && spc.json.bulk.supported === false, "service provider config advertises PATCH and filtering");
  check((await scim("GET", "/ResourceTypes")).json.totalResults === 2 && (await scim("GET", "/Schemas")).json.Resources.length === 2, "resource types and schemas are published");

  /* --------------------------------- Create --------------------------------- */
  const okta = await scim("POST", "/Users", { schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"], userName: `Priya.Shah@${domain}`, name: { givenName: "Priya", familyName: "Shah" }, emails: [{ primary: true, value: `Priya.Shah@${domain}`, type: "work" }], active: true, externalId: "00u-okta-1" });
  check(okta.status === 201 && okta.json.userName === `priya.shah@${domain}` && okta.json.displayName === "Priya Shah" && okta.json.groups[0].value === "recruiter", "Okta can create a user, who gets the default role");
  const uid = okta.json.id as string;
  check((await scim("POST", "/Users", { userName: "x@gmail.com", active: true })).json.scimType === "invalidValue", "only emails on verified domains can be provisioned");
  const dup = await scim("POST", "/Users", { userName: `priya.shah@${domain}`, active: true });
  check(dup.status === 409 && dup.json.scimType === "uniqueness", "a duplicate userName is a uniqueness conflict");
  check((await scim("POST", "/Users", { userName: process.env.ADMIN_EMAIL, active: true })).status === 400, "accounts outside the organisation's domains can't be claimed");

  /* ------------------------------ Filter & page ----------------------------- */
  const f = await scim("GET", `/Users?filter=${encodeURIComponent(`userName eq "PRIYA.SHAH@${domain}"`)}`);
  check(f.json.totalResults === 1 && f.json.Resources[0].id === uid, "filtering by userName is case-insensitive");
  check((await scim("GET", `/Users?filter=${encodeURIComponent('externalId eq "00u-okta-1"')}`)).json.totalResults === 1, "filtering by externalId works");
  check((await scim("GET", `/Users?filter=${encodeURIComponent('userName sw "p"')}`)).json.scimType === "invalidFilter", "unsupported filters are reported");
  const page = await scim("GET", "/Users?startIndex=1&count=0");
  check(page.json.totalResults >= 3 && page.json.Resources.length === 0, "count=0 returns just the total");

  /* --------------------------- Sessions & deactivation ---------------------- */
  await admin.json("PUT", `/api/settings/users/${uid}`, { password: pw });
  const priya = await new Client().login(`priya.shah@${domain}`, pw);
  check((await priya.req("GET", "/app")).status === 200, "a provisioned user can sign in");
  await scim("PATCH", `/Users/${uid}`, { schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], Operations: [{ op: "Replace", path: "active", value: "False" }] });
  check((await priya.req("GET", "/app")).status !== 200, "deactivating (Entra-style PATCH) signs the user out everywhere");
  check((await new Client().req("POST", "/api/auth/login", { email: `priya.shah@${domain}`, password: pw })).status !== 200, "a deactivated user can't sign in");
  await scim("PATCH", `/Users/${uid}`, { Operations: [{ op: "replace", value: { active: true, "name.givenName": "Priyanka", displayName: "Priyanka Shah" } }] });
  const back = await scim("GET", `/Users/${uid}`);
  check(back.json.active === true && back.json.displayName === "Priyanka Shah", "reactivation and name changes in one PATCH");

  /* --------------------------------- Groups --------------------------------- */
  const groups = await scim("GET", "/Groups?excludedAttributes=members");
  check(groups.json.totalResults === 4 && groups.json.Resources.some((g: { displayName: string }) => g.displayName === "HBE Hiring Managers"), "the four role groups are listed");
  check((await scim("GET", `/Groups?filter=${encodeURIComponent('displayName eq "HBE Admins"')}`)).json.Resources[0].id === "admin", "groups can be found by name");
  await scim("PATCH", "/Groups/hiring_manager", { Operations: [{ op: "add", path: "members", value: [{ value: uid }] }] });
  const [r1] = await q<{ role: string }>("select role from users where id = $1", [uid]);
  check(r1.role === "hiring_manager" && (await scim("GET", "/Groups/hiring_manager")).json.members.some((m: { value: string }) => m.value === uid), "adding someone to a role group sets their role");
  await scim("PATCH", "/Groups/hiring_manager", { Operations: [{ op: "remove", path: `members[value eq "${uid}"]` }] });
  const [r2] = await q<{ role: string }>("select role from users where id = $1", [uid]);
  check(r2.role === "recruiter", "removing them falls back to the default role");
  check((await scim("POST", "/Groups", { displayName: "Random" })).json.scimType === "mutability", "groups can't be created");
  check((await scim("DELETE", "/Groups/admin")).status === 403, "role groups can't be deleted");

  /* --------------------------------- Replace -------------------------------- */
  const rep = await scim("PUT", `/Users/${uid}`, { userName: `priyanka@${domain}`, name: { givenName: "Priyanka", familyName: "Shah-Rao" }, active: true });
  check(rep.status === 200 && rep.json.userName === `priyanka@${domain}` && rep.json.name.familyName === "Shah-Rao", "PUT replaces the user (including email on a verified domain)");
  check((await scim("PUT", `/Users/${uid}`, { userName: "priyanka@elsewhere.com", active: true })).status === 400, "changing to an unverified domain is refused");

  /* ------------------------------- Deprovision ------------------------------ */
  const del = await fetch(`${BASE}/scim/v2/Users/${uid}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
  check(del.status === 204, "DELETE deprovisions");
  check((await scim("GET", `/Users/${uid}`)).status === 404, "a deprovisioned user is gone from SCIM");
  const [gone] = await q<{ active: boolean; scim_deprovisioned_at: Date | null }>("select active, scim_deprovisioned_at from users where id = $1", [uid]);
  check(!gone.active && gone.scim_deprovisioned_at, "…but kept (deactivated) for the audit trail");
  check((await admin.req("GET", "/app/settings")).text.includes("deprovisioned (SCIM)"), "settings show deprovisioned accounts");
  const audits = await q<{ action: string }>("select action from audit_log where entity_id = $1 and action like 'scim.%'", [uid]);
  const acts = new Set(audits.map((a) => a.action));
  check(["scim.user_create", "scim.user_patch", "scim.role_change", "scim.user_replace", "scim.user_delete"].every((a) => acts.has(a)), "every provisioning change is audited");

  /* --------------------------- Isolation & platform ------------------------- */
  const [platformUser] = await q<{ id: string }>("select id from users where email = $1", [process.env.ADMIN_EMAIL!.toLowerCase()]);
  const { token: homeToken } = await platform.json<{ token: string }>("POST", "/api/settings/scim", { defaultRole: "viewer" });
  const home = idp(homeToken);
  const homeList = await home("GET", "/Users?count=200");
  check(!homeList.json.Resources.some((u: { id: string }) => u.id === platformUser.id) && (await home("GET", `/Users/${platformUser.id}`)).status === 404, "platform administrators are invisible to SCIM");
  check((await home("PATCH", `/Users/${platformUser.id}`, { Operations: [{ op: "replace", path: "active", value: false }] })).status === 404, "…and can't be deactivated through it");
  const [rex] = await q<{ id: string }>("select id from users where email = $1", [recruiterEmail]);
  check((await home("GET", `/Users/${rex.id}`)).status === 404 && !(await home("GET", `/Users?filter=${encodeURIComponent(`userName eq "${recruiterEmail}"`)}`)).json.totalResults, "one organisation's token can't see another's users");
  await platform.json("PATCH", "/api/settings/scim", { enabled: false });
  check((await home("GET", "/Users")).status === 401, "a paused token is refused");
  await platform.json("PATCH", "/api/settings/scim", { enabled: true });

  /* --------------------------------- Rotation ------------------------------- */
  const { token: rotated } = await admin.json<{ token: string }>("POST", "/api/settings/scim", { defaultRole: "viewer" });
  check((await scim("GET", "/Users")).status === 401 && (await idp(rotated)("GET", "/Users")).status === 200, "rotating the token invalidates the old one");
  await platform.json("PUT", `/api/platform/orgs/${org.id}`, { status: "suspended" });
  check((await idp(rotated)("GET", "/Users")).status === 403, "a suspended organisation can't be provisioned");
  await platform.json("PUT", `/api/platform/orgs/${org.id}`, { status: "active" });
  const settings = await admin.req("GET", "/app/settings");
  check(settings.text.includes("User provisioning (SCIM 2.0)") && settings.text.includes("/scim/v2") && !settings.text.includes(rotated), "settings show the SCIM base URL but never the token");

  // Don't leave a live provisioning token in the main organisation.
  const [{ org_id: homeOrg }] = await q<{ org_id: string }>("select org_id from users where id = $1", [platformUser.id]);
  await q("delete from scim_configs where org_id = $1", [homeOrg]);
  await db.end();
  console.log(`\nPHASE 12 CHECKS PASSED (${passed} checks)`);
}

main().catch((e) => {
  console.error("\nPHASE 12 CHECKS FAILED:", e);
  process.exit(1);
});
