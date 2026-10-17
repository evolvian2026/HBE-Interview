import { and, eq, inArray, sql } from "drizzle-orm";
import { passwordProblem } from "@/lib/core/password";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { HttpError, hashPassword, requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { audit } from "@/lib/audit";

const Body = z.object({
  role: z.enum(["admin", "recruiter", "hiring_manager", "viewer"]).optional(),
  active: z.boolean().optional(),
  password: z.string().min(1).max(200).optional(),
  /** Clear the user's two-factor setup (lost phone); they enrol again at next sign-in if required. */
  reset2fa: z.literal(true).optional(),
  driveIds: z.array(z.string().uuid()).max(500).optional(),
});

export const PUT = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const admin = await requireStaff("admin");
  const { id } = await params;
  const b = Body.parse(await req.json());
  const [target] = await db.select().from(schema.users).where(and(eq(schema.users.id, id), eq(schema.users.orgId, admin.orgId)));
  if (!target) throw new HttpError(404, "User not found");
  if (target.platformAdmin && !admin.platformAdmin) throw new HttpError(403, "Platform administrator accounts can only be changed by a platform administrator");
  if (b.driveIds?.length) {
    const own = await db.select({ id: schema.drives.id }).from(schema.drives).where(and(eq(schema.drives.orgId, admin.orgId), inArray(schema.drives.id, b.driveIds)));
    if (own.length !== new Set(b.driveIds).size) throw new HttpError(400, "Unknown hiring drive");
  }
  if (b.password) {
    const problem = passwordProblem(b.password, target.email, target.name);
    if (problem) throw new HttpError(400, problem);
  }
  // Any change to who the user is or how they sign in revokes their existing sessions.
  const revoke = !!(b.password || b.reset2fa || b.active === false || (b.role && b.role !== target.role));
  if (id === admin.id && (b.active === false || (b.role && b.role !== "admin"))) throw new HttpError(400, "You can't deactivate or demote yourself");
  await db
    .update(schema.users)
    .set({ ...(b.role ? { role: b.role } : {}), ...(b.active !== undefined ? { active: b.active } : {}), ...(b.password ? { passwordHash: await hashPassword(b.password) } : {}), ...(b.driveIds ? { driveIds: b.driveIds } : {}),
      ...(b.password ? { passwordChangedAt: new Date(), failedLogins: 0, lockedUntil: null } : {}),
      ...(b.reset2fa ? { totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: [] } : {}),
      ...(revoke ? { sessionVersion: sql`${schema.users.sessionVersion} + 1` } : {}),
    })
    .where(and(eq(schema.users.id, id), eq(schema.users.orgId, admin.orgId)));
  await audit({ type: "staff", id: admin.id, orgId: admin.orgId }, "user.update", "user", id, { role: b.role, active: b.active, password: !!b.password, driveIds: b.driveIds, reset2fa: !!b.reset2fa, sessionsRevoked: revoke });
  return json({ ok: true });
});
