import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { env } from "../env";

export type StaffRole = "admin" | "recruiter" | "hiring_manager" | "viewer";
export interface StaffUser {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
  /** Assigned drives — only enforced for hiring managers. */
  driveIds?: string[];
}

const COOKIE = "hbe_staff";
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

export async function createStaffSession(user: StaffUser) {
  const token = await new SignJWT({ role: user.role })
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

export async function getStaff(): Promise<StaffUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, String(payload.sub)));
    if (!u || !u.active) return null;
    return { id: u.id, email: u.email, name: u.name, role: u.role, driveIds: u.driveIds ?? [] };
  } catch {
    return null;
  }
}

export function hasRole(user: StaffUser, min: StaffRole) {
  return RANK[user.role] >= RANK[min];
}

/** For server components/pages: redirect to login when not signed in. */
export async function requireStaffPage(min: StaffRole = "viewer"): Promise<StaffUser> {
  const u = await getStaff();
  if (!u) redirect("/login");
  if (!hasRole(u, min)) redirect("/app?forbidden=1");
  return u;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** For route handlers: throw 401/403. */
export async function requireStaff(min: StaffRole = "viewer"): Promise<StaffUser> {
  const u = await getStaff();
  if (!u) throw new HttpError(401, "Not signed in");
  if (!hasRole(u, min)) throw new HttpError(403, "You don't have permission to do this");
  return u;
}

/** Create the first admin from ADMIN_EMAIL/ADMIN_PASSWORD if there are no users yet. */
export async function ensureBootstrapAdmin() {
  if (!env.adminEmail || !env.adminPassword) return;
  const existing = await db.select({ id: schema.users.id }).from(schema.users).limit(1);
  if (existing.length) return;
  await db
    .insert(schema.users)
    .values({ email: env.adminEmail.toLowerCase(), name: "Administrator", passwordHash: await hashPassword(env.adminPassword), role: "admin" })
    .onConflictDoNothing();
}

/** Hiring managers only see drives they are assigned to; other roles see every drive. */
export function canSeeDrive(user: StaffUser, driveId: string) {
  return user.role !== "hiring_manager" || (user.driveIds ?? []).includes(driveId);
}

export function assertDriveAccess(user: StaffUser, driveId: string) {
  if (!canSeeDrive(user, driveId)) throw new HttpError(403, "You are not assigned to this hiring drive");
}

/** Resolve a candidacy's drive and check access (route handlers). */
export async function assertCandidacyAccess(user: StaffUser, candidacyId: string) {
  const [c] = await db.select({ driveId: schema.candidacies.driveId }).from(schema.candidacies).where(eq(schema.candidacies.id, candidacyId));
  if (!c) throw new HttpError(404, "Candidate not found");
  assertDriveAccess(user, c.driveId);
  return c.driveId;
}
