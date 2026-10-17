import { randomBytes } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { and, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "../db";
import { HttpError, hashPassword, type StaffUser } from "../auth/staff";
import { audit } from "../audit";
import { domainOfEmail, domainProblem, normalizeDomain, verificationRecord } from "../core/domain";
import { seal, unseal } from "../security/secrets";
import { discover, forgetIssuer, normalizeIssuer, SsoError, type VerifiedIdentity } from "../sso/oidc";


/* --------------------------------- Domains --------------------------------- */

export async function listDomains(orgId: string) {
  return db.select().from(schema.orgDomains).where(eq(schema.orgDomains.orgId, orgId)).orderBy(schema.orgDomains.domain);
}

export async function addDomain(orgId: string, raw: string, by: StaffUser) {
  const problem = domainProblem(raw);
  if (problem) throw new HttpError(400, problem);
  const domain = normalizeDomain(raw)!;
  const [row] = await db
    .insert(schema.orgDomains)
    .values({ orgId, domain, verificationToken: randomBytes(16).toString("hex") })
    .onConflictDoNothing()
    .returning();
  if (!row) throw new HttpError(409, "This domain is already registered by an organisation");
  await audit({ type: "staff", id: by.id, orgId }, "settings.domain_added", "org_domain", row.id, { domain });
  return row;
}

/** Look for the TXT record `hbe-verification=<token>` on the domain. */
export async function verifyDomainDns(orgId: string, id: string, by: StaffUser, resolver: (d: string) => Promise<string[][]> = resolveTxt) {
  const [d] = await db.select().from(schema.orgDomains).where(and(eq(schema.orgDomains.id, id), eq(schema.orgDomains.orgId, orgId)));
  if (!d) throw new HttpError(404, "Domain not found");
  if (d.verifiedAt) return d;
  const records = await resolver(d.domain).catch(() => [] as string[][]);
  if (!records.map((r) => r.join("")).includes(verificationRecord(d.verificationToken)))
    throw new HttpError(400, `TXT record not found yet. Add "${verificationRecord(d.verificationToken)}" to ${d.domain} and try again (DNS changes can take a while).`);
  const [v] = await db.update(schema.orgDomains).set({ verifiedAt: new Date(), verifiedBy: "dns" }).where(eq(schema.orgDomains.id, id)).returning();
  await audit({ type: "staff", id: by.id, orgId }, "settings.domain_verified", "org_domain", id, { domain: d.domain, method: "dns" });
  return v;
}

/** Platform admins can confirm a domain after checking ownership another way (e.g. a contract). */
export async function confirmDomainByPlatform(id: string, by: StaffUser) {
  const [v] = await db.update(schema.orgDomains).set({ verifiedAt: new Date(), verifiedBy: "platform" }).where(eq(schema.orgDomains.id, id)).returning();
  if (!v) throw new HttpError(404, "Domain not found");
  await audit({ type: "staff", id: by.id, orgId: v.orgId }, "settings.domain_verified", "org_domain", id, { domain: v.domain, method: "platform" });
  return v;
}

export async function removeDomain(orgId: string, id: string, by: StaffUser) {
  const gone = await db.delete(schema.orgDomains).where(and(eq(schema.orgDomains.id, id), eq(schema.orgDomains.orgId, orgId))).returning();
  if (!gone.length) throw new HttpError(404, "Domain not found");
  await audit({ type: "staff", id: by.id, orgId }, "settings.domain_removed", "org_domain", id, { domain: gone[0].domain });
}

/* ------------------------------ Configuration ------------------------------ */

export interface SsoInput {
  issuer: string;
  clientId: string;
  clientSecret?: string;
  enabled: boolean;
  required: boolean;
  jitRole: "recruiter" | "hiring_manager" | "viewer" | null;
}

export async function getSsoConfig(orgId: string) {
  const [c] = await db.select().from(schema.ssoConfigs).where(eq(schema.ssoConfigs.orgId, orgId));
  return c ?? null;
}

export async function saveSsoConfig(orgId: string, input: SsoInput, by: StaffUser) {
  const existing = await getSsoConfig(orgId);
  const issuer = normalizeIssuer(input.issuer);
  if (!existing && !input.clientSecret) throw new HttpError(400, "Enter the client secret");
  if (input.enabled) {
    try {
      await discover(issuer); // fail fast on a wrong issuer URL
    } catch (e) {
      throw new HttpError(400, `Couldn't reach the identity provider: ${(e as Error).message}`);
    }
    const verified = await db.select({ id: schema.orgDomains.id }).from(schema.orgDomains).where(and(eq(schema.orgDomains.orgId, orgId), isNotNull(schema.orgDomains.verifiedAt))).limit(1);
    if (!verified.length) throw new HttpError(400, "Verify at least one email domain before turning on single sign-on");
  }
  if (input.required && !input.enabled) throw new HttpError(400, "Turn on single sign-on before requiring it");
  if (input.required && !existing?.lastTestedAt && !by.platformAdmin) throw new HttpError(400, "Sign in once with single sign-on (Test sign-in) before requiring it, so nobody gets locked out");
  const values = {
    issuer,
    clientId: input.clientId.trim(),
    clientSecret: input.clientSecret ? seal(input.clientSecret) : existing!.clientSecret,
    enabled: input.enabled,
    required: input.required,
    jitRole: input.jitRole,
    updatedAt: new Date(),
  };
  if (existing) await db.update(schema.ssoConfigs).set(values).where(eq(schema.ssoConfigs.orgId, orgId));
  else await db.insert(schema.ssoConfigs).values({ orgId, ...values });
  forgetIssuer(issuer);
  await audit({ type: "staff", id: by.id, orgId }, "settings.sso_updated", "sso_config", orgId, { issuer, clientId: values.clientId, enabled: input.enabled, required: input.required, jitRole: input.jitRole, secretChanged: !!input.clientSecret });
}

export const ssoSecret = (c: { clientSecret: string }) => unseal(c.clientSecret);

/* ---------------------------------- Login ---------------------------------- */

/** The organisation whose verified domain matches the email and that has SSO switched on. */
export async function ssoForEmail(email: string) {
  const domain = domainOfEmail(email);
  if (!domain) return null;
  const [row] = await db
    .select({ cfg: schema.ssoConfigs, status: schema.organizations.status })
    .from(schema.orgDomains)
    .innerJoin(schema.ssoConfigs, eq(schema.ssoConfigs.orgId, schema.orgDomains.orgId))
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.orgDomains.orgId))
    .where(and(eq(schema.orgDomains.domain, domain), isNotNull(schema.orgDomains.verifiedAt), eq(schema.ssoConfigs.enabled, true)));
  if (!row || row.status !== "active") return null;
  return row.cfg;
}

/** Whether password sign-in is refused for this user because their organisation requires SSO. */
export async function passwordBlockedBySso(user: { orgId: string; platformAdmin: boolean }) {
  if (user.platformAdmin) return false; // break-glass access stays available
  const c = await getSsoConfig(user.orgId);
  return !!(c?.enabled && c.required);
}

/**
 * Map a verified identity to a staff account in the organisation: existing user by email (same organisation only),
 * or a new one when just-in-time provisioning is on.
 */
export async function resolveSsoUser(orgId: string, id: VerifiedIdentity, opts: { test: boolean }) {
  const domain = domainOfEmail(id.email);
  const [owned] = domain
    ? await db.select().from(schema.orgDomains).where(and(eq(schema.orgDomains.orgId, orgId), eq(schema.orgDomains.domain, domain), isNotNull(schema.orgDomains.verifiedAt)))
    : [];
  if (!owned) throw new SsoError(`${id.email} isn't in one of this organisation's verified domains`);
  const cfg = await getSsoConfig(orgId);
  const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, id.email));
  if (existing) {
    if (existing.orgId !== orgId) throw new SsoError("This email belongs to an account in another organisation");
    if (!existing.active) throw new SsoError("Your account is deactivated. Ask an administrator to reactivate it.");
    return { user: existing, created: false };
  }
  if (!cfg?.jitRole || opts.test) throw new SsoError("You don't have an account in this organisation yet. Ask an administrator to add you.");
  const [user] = await db
    .insert(schema.users)
    .values({ orgId, email: id.email, name: id.name, role: cfg.jitRole, passwordHash: await hashPassword(randomBytes(32).toString("hex")) })
    .returning();
  await audit({ type: "system", orgId }, "user.sso_provisioned", "user", user.id, { email: id.email, role: cfg.jitRole });
  return { user, created: true };
}

export async function markSsoTested(orgId: string) {
  await db.update(schema.ssoConfigs).set({ lastTestedAt: new Date() }).where(eq(schema.ssoConfigs.orgId, orgId));
}

export { SsoError };
