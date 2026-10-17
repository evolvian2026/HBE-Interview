import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { HttpError, requireStaff, verifyPassword } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { audit } from "@/lib/audit";
import { getSettings } from "@/lib/settings";
import { limit } from "@/lib/security/rate-limit";

const Body = z.object({ password: z.string().min(1).max(200) });

/** Turn two-factor sign-in off (password required; not allowed when the organisation requires it). */
export const POST = handle(async (req: Request) => {
  const user = await requireStaff("viewer");
  await limit(`reauth:${user.id}`, 10, 15 * 60);
  const { password } = Body.parse(await req.json());
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
  if (!(await verifyPassword(password, u.passwordHash))) throw new HttpError(401, "Incorrect password");
  if ((await getSettings(u.orgId)).require2fa) throw new HttpError(400, "Your organisation requires two-factor sign-in");
  await db.update(schema.users).set({ totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: [] }).where(eq(schema.users.id, u.id));
  await audit({ type: "staff", id: u.id, orgId: u.orgId }, "auth.2fa_disabled", "user", u.id);
  return json({ ok: true });
});
