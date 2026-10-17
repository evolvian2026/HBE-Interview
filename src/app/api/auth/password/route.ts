import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { createStaffSession, hashPassword, HttpError, requireStaff, verifyPassword } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { audit } from "@/lib/audit";
import { passwordProblem } from "@/lib/core/password";
import { limit } from "@/lib/security/rate-limit";

const Body = z.object({ current: z.string().min(1).max(200), next: z.string().min(1).max(200) });

/** Change your password. Signs out every other session (this one is re-issued). */
export const POST = handle(async (req: Request) => {
  const user = await requireStaff("viewer", { allowEnrollment: true });
  await limit(`reauth:${user.id}`, 10, 15 * 60);
  const { current, next } = Body.parse(await req.json());
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
  if (!(await verifyPassword(current, u.passwordHash))) throw new HttpError(401, "Current password is incorrect");
  const problem = passwordProblem(next, u.email, u.name);
  if (problem) throw new HttpError(400, problem);
  const [updated] = await db
    .update(schema.users)
    .set({ passwordHash: await hashPassword(next), passwordChangedAt: new Date(), sessionVersion: sql`${schema.users.sessionVersion} + 1` })
    .where(eq(schema.users.id, u.id))
    .returning();
  await createStaffSession(updated, user.orgId !== user.homeOrgId ? user.orgId : undefined);
  await audit({ type: "staff", id: u.id, orgId: u.orgId }, "auth.password_changed", "user", u.id);
  return json({ ok: true });
});
