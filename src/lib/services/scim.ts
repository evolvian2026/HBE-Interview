import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { env } from "../env";
import { HttpError, hashPassword, type StaffUser } from "../auth/staff";
import { audit } from "../audit";
import { domainOfEmail } from "../core/domain";
import { ROLE_GROUPS, ScimError, applyUserPatch, groupPatch, listResponse, paging, parseFilter, toScimGroup, toScimUser, userFromBody, type ScimRole, type ScimUserState } from "../core/scim";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const scimBase = () => `${env.appBaseUrl.replace(/\/$/, "")}/scim/v2`;

/* ------------------------------ Configuration ----------------------------- */

export async function getScimConfig(orgId: string) {
  const [c] = await db.select().from(schema.scimConfigs).where(eq(schema.scimConfigs.orgId, orgId));
  return c ?? null;
}

/** Create or rotate the organisation's SCIM token. The token is shown once; only its hash is kept. */
export async function issueScimToken(user: StaffUser, defaultRole: Exclude<ScimRole, "admin">) {
  const token = `scim_${randomBytes(32).toString("base64url")}`;
  const values = { tokenHash: sha(token), tokenPrefix: token.slice(0, 12), defaultRole, enabled: true, lastUsedAt: null, updatedAt: new Date() };
  await db.insert(schema.scimConfigs).values({ orgId: user.orgId, ...values }).onConflictDoUpdate({ target: schema.scimConfigs.orgId, set: values });
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "scim.token_issue", "settings", "scim", { defaultRole });
  return token;
}

export async function updateScimConfig(user: StaffUser, patch: { enabled?: boolean; defaultRole?: Exclude<ScimRole, "admin"> }) {
  const c = await getScimConfig(user.orgId);
  if (!c) throw new HttpError(404, "Set up provisioning first");
  await db.update(schema.scimConfigs).set({ ...patch, updatedAt: new Date() }).where(eq(schema.scimConfigs.orgId, user.orgId));
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "scim.update", "settings", "scim", patch);
}

/* ---------------------------------- Auth ---------------------------------- */

export interface ScimCtx {
  orgId: string;
  defaultRole: ScimRole;
}

/** Bearer-token authentication for the identity provider. */
export async function scimAuth(req: Request): Promise<ScimCtx> {
  const h = req.headers.get("authorization") ?? "";
  const token = h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
  if (!token.startsWith("scim_")) throw new ScimError(401, "Missing or invalid bearer token");
  const [row] = await db
    .select({ c: schema.scimConfigs, status: schema.organizations.status })
    .from(schema.scimConfigs)
    .innerJoin(schema.organizations, eq(schema.scimConfigs.orgId, schema.organizations.id))
    .where(eq(schema.scimConfigs.tokenHash, sha(token)));
  if (!row || !row.c.enabled) throw new ScimError(401, "Missing or invalid bearer token");
  if (row.status !== "active") throw new ScimError(403, "This organisation is suspended");
  // At most one write of last-used per minute.
  if (!row.c.lastUsedAt || Date.now() - row.c.lastUsedAt.getTime() > 60_000) await db.update(schema.scimConfigs).set({ lastUsedAt: new Date() }).where(eq(schema.scimConfigs.orgId, row.c.orgId));
  return { orgId: row.c.orgId, defaultRole: row.c.defaultRole as ScimRole };
}

const actor = (ctx: ScimCtx) => ({ type: "system" as const, id: "scim", orgId: ctx.orgId });

/* ---------------------------------- Users --------------------------------- */

/** Users SCIM may see and manage: this organisation's, never platform admins, not deprovisioned. */
const manageable = (orgId: string) => and(eq(schema.users.orgId, orgId), eq(schema.users.platformAdmin, false), isNull(schema.users.scimDeprovisionedAt));

async function loadUser(ctx: ScimCtx, id: string) {
  const [u] = /^[0-9a-f-]{36}$/i.test(id) ? await db.select().from(schema.users).where(and(eq(schema.users.id, id), manageable(ctx.orgId))) : [];
  if (!u) throw new ScimError(404, "User not found");
  return u;
}

const stateOf = (u: typeof schema.users.$inferSelect): ScimUserState => {
  const [given, ...rest] = u.name.split(/\s+/);
  return { userName: u.email, givenName: given ?? "", familyName: rest.join(" "), displayName: u.name, active: u.active, externalId: u.scimExternalId };
};

async function assertVerifiedDomain(orgId: string, email: string) {
  const domain = domainOfEmail(email);
  if (!domain || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ScimError(400, "userName must be an email address", "invalidValue");
  const [d] = await db.select({ id: schema.orgDomains.id }).from(schema.orgDomains).where(and(eq(schema.orgDomains.orgId, orgId), eq(schema.orgDomains.domain, domain), sql`${schema.orgDomains.verifiedAt} is not null`));
  if (!d) throw new ScimError(400, `${domain} isn't a verified domain of this organisation (Settings → Single sign-on → Email domains)`, "invalidValue");
}

export async function listUsers(ctx: ScimCtx, params: URLSearchParams) {
  const f = parseFilter(params.get("filter"));
  const { startIndex, count } = paging(params);
  const where = and(
    manageable(ctx.orgId),
    f?.attr === "username" || f?.attr === "emails.value" ? eq(schema.users.email, f.value.toLowerCase()) : undefined,
    f?.attr === "externalid" ? eq(schema.users.scimExternalId, f.value) : undefined,
    f?.attr === "id" ? eq(schema.users.id, /^[0-9a-f-]{36}$/i.test(f.value) ? f.value : "00000000-0000-0000-0000-000000000000") : undefined,
    f?.attr === "displayname" ? eq(schema.users.name, f.value) : undefined,
  );
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.users).where(where);
  const rows = count ? await db.select().from(schema.users).where(where).orderBy(asc(schema.users.createdAt)).offset(startIndex - 1).limit(count) : [];
  return listResponse(rows.map((u) => toScimUser(u, scimBase())), n, startIndex);
}

export async function getUser(ctx: ScimCtx, id: string) {
  return toScimUser(await loadUser(ctx, id), scimBase());
}

export async function createUser(ctx: ScimCtx, body: Record<string, unknown>) {
  const s = userFromBody(body);
  await assertVerifiedDomain(ctx.orgId, s.userName);
  const [clash] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, s.userName));
  if (clash) throw new ScimError(409, "A user with this userName already exists", "uniqueness");
  const [u] = await db
    .insert(schema.users)
    .values({
      orgId: ctx.orgId,
      email: s.userName,
      name: s.displayName,
      // Provisioned users sign in with SSO; the random password is never disclosed.
      passwordHash: await hashPassword(randomBytes(24).toString("base64url")),
      role: ctx.defaultRole,
      active: s.active,
      scimExternalId: s.externalId,
      provisionedBy: "scim",
    })
    .returning();
  await audit(actor(ctx), "scim.user_create", "user", u.id, { email: u.email, role: u.role, active: u.active });
  return toScimUser(u, scimBase());
}

async function save(ctx: ScimCtx, u: typeof schema.users.$inferSelect, next: ScimUserState, op: string) {
  if (next.userName !== u.email) {
    await assertVerifiedDomain(ctx.orgId, next.userName);
    const [clash] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, next.userName));
    if (clash && clash.id !== u.id) throw new ScimError(409, "A user with this userName already exists", "uniqueness");
  }
  const deactivating = u.active && !next.active;
  const [saved] = await db
    .update(schema.users)
    .set({
      email: next.userName,
      name: next.displayName || u.name,
      active: next.active,
      scimExternalId: next.externalId,
      provisionedBy: "scim",
      // Deactivation (or an email change) signs the person out everywhere.
      ...(deactivating || next.userName !== u.email ? { sessionVersion: u.sessionVersion + 1 } : {}),
    })
    .where(eq(schema.users.id, u.id))
    .returning();
  await audit(actor(ctx), op, "user", u.id, { active: next.active, ...(next.userName !== u.email ? { email: next.userName } : {}), ...(deactivating ? { deactivated: true } : {}) });
  return toScimUser(saved, scimBase());
}

export async function replaceUser(ctx: ScimCtx, id: string, body: Record<string, unknown>) {
  const u = await loadUser(ctx, id);
  return save(ctx, u, userFromBody(body, stateOf(u)), "scim.user_replace");
}

export async function patchUser(ctx: ScimCtx, id: string, body: Record<string, unknown>) {
  const u = await loadUser(ctx, id);
  return save(ctx, u, applyUserPatch(stateOf(u), body), "scim.user_patch");
}

/** DELETE deprovisions: the account is deactivated and signed out, kept for the audit trail, and no longer visible to SCIM. */
export async function deleteUser(ctx: ScimCtx, id: string) {
  const u = await loadUser(ctx, id);
  await db.update(schema.users).set({ active: false, scimDeprovisionedAt: new Date(), sessionVersion: u.sessionVersion + 1 }).where(eq(schema.users.id, u.id));
  await audit(actor(ctx), "scim.user_delete", "user", u.id, { email: u.email });
}

/* --------------------------------- Groups --------------------------------- */

async function groupMembers(ctx: ScimCtx, role: ScimRole) {
  return db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(and(manageable(ctx.orgId), eq(schema.users.role, role))).orderBy(asc(schema.users.name));
}

function groupOf(id: string) {
  const g = ROLE_GROUPS.find((x) => x.id === id);
  if (!g) throw new ScimError(404, "Group not found");
  return g;
}

export async function listGroups(ctx: ScimCtx, params: URLSearchParams) {
  const f = parseFilter(params.get("filter"));
  const groups = ROLE_GROUPS.filter((g) => !f || (f.attr === "displayname" ? g.displayName.toLowerCase() === f.value.toLowerCase() : f.attr === "id" ? g.id === f.value : false));
  const excludeMembers = (params.get("excludedAttributes") ?? "").toLowerCase().includes("members");
  const out = await Promise.all(groups.map(async (g) => toScimGroup(g, excludeMembers ? [] : await groupMembers(ctx, g.id), scimBase())));
  return listResponse(out, out.length, 1);
}

export async function getGroup(ctx: ScimCtx, id: string) {
  const g = groupOf(id);
  return toScimGroup(g, await groupMembers(ctx, g.id), scimBase());
}

async function setRole(ctx: ScimCtx, userIds: string[], role: ScimRole) {
  if (!userIds.length) return;
  const users = await db.select().from(schema.users).where(and(manageable(ctx.orgId), inArray(schema.users.id, userIds.filter((x) => /^[0-9a-f-]{36}$/i.test(x)))));
  for (const u of users) {
    if (u.role === role) continue;
    // A role change takes effect at once: the user's sessions are revoked.
    await db.update(schema.users).set({ role, sessionVersion: u.sessionVersion + 1 }).where(eq(schema.users.id, u.id));
    await audit(actor(ctx), "scim.role_change", "user", u.id, { from: u.role, to: role });
  }
}

/** Group membership sets the role; leaving your role's group falls back to the organisation's default role. */
export async function patchGroup(ctx: ScimCtx, id: string, body: Record<string, unknown>) {
  const g = groupOf(id);
  const { add, remove, replace } = groupPatch(body);
  const fallback: ScimRole = ctx.defaultRole === g.id ? "viewer" : ctx.defaultRole;
  if (replace) {
    const current = (await groupMembers(ctx, g.id)).map((m) => m.id);
    await setRole(ctx, current.filter((x) => !replace.includes(x)), fallback);
    await setRole(ctx, replace, g.id);
  }
  await setRole(ctx, add, g.id);
  const leaving = (await groupMembers(ctx, g.id)).map((m) => m.id).filter((x) => remove.includes(x));
  await setRole(ctx, leaving, fallback);
  return getGroup(ctx, id);
}

export async function replaceGroup(ctx: ScimCtx, id: string, body: Record<string, unknown>) {
  const members = Array.isArray(body.members) ? (body.members as { value?: string }[]).map((m) => String(m.value ?? "")).filter(Boolean) : [];
  return patchGroup(ctx, id, { Operations: [{ op: "replace", path: "members", value: members.map((value) => ({ value })) }] });
}

/** Counts for the settings card. */
export async function provisioningStats(orgId: string) {
  const [r] = await db
    .select({ total: sql<number>`count(*)::int`, active: sql<number>`count(*) filter (where ${schema.users.active})::int` })
    .from(schema.users)
    .where(and(eq(schema.users.orgId, orgId), eq(schema.users.provisionedBy, "scim"), isNull(schema.users.scimDeprovisionedAt)));
  return r;
}
