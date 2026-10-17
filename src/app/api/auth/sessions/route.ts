import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { clearStaffSession, requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { audit } from "@/lib/audit";

/** Sign out everywhere: revokes every session of this user, including this one. */
export const DELETE = handle(async () => {
  const user = await requireStaff("viewer", { allowEnrollment: true });
  await db.update(schema.users).set({ sessionVersion: sql`${schema.users.sessionVersion} + 1` }).where(eq(schema.users.id, user.id));
  await clearStaffSession();
  await audit({ type: "staff", id: user.id, orgId: user.homeOrgId }, "auth.signout_all", "user", user.id);
  return json({ ok: true });
});
