import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { env } from "../env";
import { DEFAULT_ORG_ID, ensureDefaultOrg } from "../tenancy";
import { getSettings } from "../settings";

export type StaffRole = "admin" | "recruiter" | "hiring_manager" | "viewer";
export interface StaffUser {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
  /** Assigned drives — only enforced for hiring managers. */
  driveIds?: string[];
  /** The organisation this session acts in. Every query a staff request makes is scoped to it. */
  orgId: string;
  /** The user's own organisation (differs from orgId only when a platform admin has switched in). */
  homeOrgId: string;
  platformAdmin: boolean;
  /** The user's organisation requires two-factor sign-in and they haven't set it up yet (only enrolment is allowed). */
  mustEnroll2fa: boolean;
  has2fa: boolean;
  sessionVersion: number;
  /** Signed in through the organisation's identity provider (which is responsible for MFA). */
  viaSso: boolean;
}

const COOKIE = "hbe_staff";
const MFA_COOKIE = "hbe_mfa";
const RANK: Record<StaffRole, number> = { viewer: 0, hiring_manager: 1, recruiter: 2, admin: 3 };

function key() {
  return new TextEncoder().encode(env.sessionSecret);
}

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}

export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

/**
 * Issue the session cookie. `activeOrgId` is honoured only for platform admins (org switching). The token carries the
 * user's session version, so bumping `users.session_version` revokes every outstanding session at once.
 */
export async function createStaffSession(user: { id: string; role: StaffRole; sessionVersion: number }, activeOrgId?: string, opts: { sso?: boolean } = {}) {
  const token = await new SignJWT({ role: user.role, sv: user.sessionVersion, ...(activeOrgId ? { org: activeOrgId } : {}), ...(opts.sso ? { amr: "sso" } : {}) })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(key());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProduction,
    path: "/",
    maxAge: 12 * 3600,
  });
}

export async function clearStaffSession() {
  (await cookies()).delete(COOKIE);
}

/** Password accepted but a TOTP code is still needed: a 5-minute, single-purpose cookie. */
export async function createMfaChallenge(user: { id: string; sessionVersion: number }) {
  const token = await new SignJWT({ purpose: "mfa", sv: user.sessionVersion }).setProtectedHeader({ alg: "HS256" }).setSubject(user.id).setIssuedAt().setExpirationTime("5m").sign(key());
  (await cookies()).set(MFA_COOKIE, token, { httpOnly: true, sameSite: "strict", secure: env.isProduction, path: "/api/auth", maxAge: 300 });
}

export async function readMfaChallenge(): Promise<{ userId: string; sv: number } | null> {
  const token = (await cookies()).get(MFA_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    if (payload.purpose !== "mfa") return null;
    return { userId: String(payload.sub), sv: Number(payload.sv ?? 0) };
  } catch {
    return null;
  }
}

export async function clearMfaChallenge() {
  (await cookies()).delete({ name: MFA_COOKIE, path: "/api/auth" });
}

export async function getStaff(): Promise<StaffUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    const [row] = await db
      .select({ u: schema.users, status: schema.organizations.status })
      .from(schema.users)
      .innerJoin(schema.organizations, eq(schema.users.orgId, schema.organizations.id))
      .where(eq(schema.users.id, String(payload.sub)));
    if (!row || !row.u.active) return null;
    const u = row.u;
    if (Number(payload.sv ?? 0) !== u.sessionVersion) return null; // revoked
    if (row.status !== "active" && !u.platformAdmin) return null;
    let orgId = u.orgId;
    if (u.platformAdmin && typeof payload.org === "string" && payload.org !== u.orgId) {
      const [o] = await db.select({ id: schema.organizations.id }).from(schema.organizations).where(eq(schema.organizations.id, payload.org));
      if (o) orgId = o.id;
    }
    // A platform admin acting inside another organisation acts as that organisation's admin.
    const role = orgId !== u.orgId ? "admin" : u.role;
    const has2fa = !!u.totpEnabledAt;
    const viaSso = payload.amr === "sso";
    // SSO sign-ins satisfy the organisation's 2FA requirement: multi-factor is enforced by the identity provider.
    const mustEnroll2fa = !has2fa && !viaSso && !!(await getSettings(u.orgId)).require2fa;
    return { id: u.id, email: u.email, name: u.name, role, driveIds: u.driveIds ?? [], orgId, homeOrgId: u.orgId, platformAdmin: u.platformAdmin, mustEnroll2fa, has2fa, sessionVersion: u.sessionVersion, viaSso };
  } catch {
    return null;
  }
}

export function hasRole(user: StaffUser, min: StaffRole) {
  return RANK[user.role] >= RANK[min];
}

/**
 * For server components/pages: redirect to login when not signed in, and to two-factor setup when the organisation
 * requires it. `allowEnrollment` is only for the layout and the security page itself.
 */
export async function requireStaffPage(min: StaffRole = "viewer", opts: { allowEnrollment?: boolean } = {}): Promise<StaffUser> {
  const u = await getStaff();
  if (!u) redirect("/login");
  if (u.mustEnroll2fa && !opts.allowEnrollment) redirect("/app/security?enroll=1");
  if (!hasRole(u, min)) redirect("/app?forbidden=1");
  return u;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Cross-site request guard for cookie-authenticated APIs: a browser always sends Origin on cross-origin requests and
 * on same-origin POST/PUT/DELETE, so an Origin that doesn't match the host is a forged request (SameSite=Lax is the
 * first line; this is the second).
 */
export async function assertSameOrigin() {
  const h = await headers();
  const origin = h.get("origin");
  if (!origin) return;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, "Cross-site request blocked");
  }
  if (originHost !== host) throw new HttpError(403, "Cross-site request blocked");
}

/** For route handlers: throw 401/403. */
export async function requireStaff(min: StaffRole = "viewer", opts: { allowEnrollment?: boolean } = {}): Promise<StaffUser> {
  await assertSameOrigin();
  const u = await getStaff();
  if (!u) throw new HttpError(401, "Not signed in");
  if (u.mustEnroll2fa && !opts.allowEnrollment) throw new HttpError(403, "Your organisation requires two-factor sign-in. Set it up under Security first.");
  if (!hasRole(u, min)) throw new HttpError(403, "You don't have permission to do this");
  return u;
}

export function requirePlatformAdmin(user: StaffUser) {
  if (!user.platformAdmin) throw new HttpError(403, "Platform administrators only");
}

/** Create the first (platform) admin from ADMIN_EMAIL/ADMIN_PASSWORD in the default organisation if there are no users yet. */
export async function ensureBootstrapAdmin() {
  await ensureDefaultOrg();
  if (!env.adminEmail || !env.adminPassword) return;
  const existing = await db.select({ id: schema.users.id }).from(schema.users).limit(1);
  if (existing.length) return;
  await db
    .insert(schema.users)
    .values({ orgId: DEFAULT_ORG_ID, platformAdmin: true, email: env.adminEmail.toLowerCase(), name: "Administrator", passwordHash: await hashPassword(env.adminPassword), role: "admin" })
    .onConflictDoNothing();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID.test(s);

/**
 * A drive is visible when it belongs to the session's organisation and — for hiring managers — is assigned to them.
 * Takes the drive row (not just its id) so the organisation check can't be skipped.
 */
export function canSeeDrive(user: StaffUser, drive: { id: string; orgId: string }) {
  return drive.orgId === user.orgId && (user.role !== "hiring_manager" || (user.driveIds ?? []).includes(drive.id));
}

/** Load a drive the user may act on (route handlers). Other organisations' drives are reported as not found. */
export async function requireDriveAccess(user: StaffUser, driveId: string) {
  const [d] = isUuid(driveId) ? await db.select().from(schema.drives).where(eq(schema.drives.id, driveId)) : [];
  if (!d || d.orgId !== user.orgId) throw new HttpError(404, "Hiring drive not found");
  if (!canSeeDrive(user, d)) throw new HttpError(403, "You are not assigned to this hiring drive");
  return d;
}

/** Pages: load a visible drive or render 404 (other organisations' drives don't exist from this session's view). */
export async function requireDrivePage(user: StaffUser, driveId: string) {
  const [d] = isUuid(driveId) ? await db.select().from(schema.drives).where(eq(schema.drives.id, driveId)) : [];
  if (!d || !canSeeDrive(user, d)) notFound();
  return d;
}

/** Resolve a candidacy and check access (route handlers). Returns its drive id. */
export async function assertCandidacyAccess(user: StaffUser, candidacyId: string) {
  const [c] = isUuid(candidacyId)
    ? await db.select({ driveId: schema.candidacies.driveId, orgId: schema.candidacies.orgId }).from(schema.candidacies).where(eq(schema.candidacies.id, candidacyId))
    : [];
  if (!c || c.orgId !== user.orgId) throw new HttpError(404, "Candidate not found");
  if (!canSeeDrive(user, { id: c.driveId, orgId: c.orgId })) throw new HttpError(403, "You are not assigned to this hiring drive");
  return c.driveId;
}
