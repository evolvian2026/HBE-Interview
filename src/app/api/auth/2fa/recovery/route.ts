import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { HttpError, requireStaff, verifyPassword } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { audit } from "@/lib/audit";
import { issueRecoveryCodes } from "@/lib/security/two-factor";
import { limit } from "@/lib/security/rate-limit";

const Body = z.object({ password: z.string().min(1).max(200) });

/** Replace all recovery codes (password required). */
export const POST = handle(async (req: Request) => {
  const user = await requireStaff("viewer");
  await limit(`reauth:${user.id}`, 10, 15 * 60);
  const { password } = Body.parse(await req.json());
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
  if (!(await verifyPassword(password, u.passwordHash))) throw new HttpError(401, "Incorrect password");
  if (!u.totpEnabledAt) throw new HttpError(400, "Two-factor sign-in is off");
  const { codes, hashes } = issueRecoveryCodes();
  await db.update(schema.users).set({ recoveryCodes: hashes }).where(eq(schema.users.id, u.id));
  await audit({ type: "staff", id: u.id, orgId: u.orgId }, "auth.recovery_codes_regenerated", "user", u.id);
  return json({ recoveryCodes: codes });
});
