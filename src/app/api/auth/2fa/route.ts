import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { clearMfaChallenge, createStaffSession, HttpError, readMfaChallenge } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { audit } from "@/lib/audit";
import { limit } from "@/lib/security/rate-limit";
import { checkSecondFactor } from "@/lib/security/two-factor";

const Body = z.object({ code: z.string().trim().min(6).max(20) });

/** Second sign-in step: a TOTP code or a recovery code, after the password was accepted. */
export const POST = handle(async (req: Request) => {
  const challenge = await readMfaChallenge();
  if (!challenge) throw new HttpError(401, "Your sign-in expired. Please enter your password again.");
  await limit(`2fa:${challenge.userId}`, 8, 15 * 60, "Too many incorrect codes. Try again in 15 minutes.");
  const { code } = Body.parse(await req.json());
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, challenge.userId));
  if (!u || !u.active || u.sessionVersion !== challenge.sv) throw new HttpError(401, "Your sign-in expired. Please enter your password again.");
  const how = await checkSecondFactor(u, code);
  if (!how) {
    await audit({ type: "staff", id: u.id, orgId: u.orgId }, "auth.2fa_failed", "user", u.id);
    throw new HttpError(401, "That code didn't work. Check your authenticator app's time and try again.");
  }
  await clearMfaChallenge();
  await createStaffSession(u);
  await audit({ type: "staff", id: u.id, orgId: u.orgId }, "auth.login", "user", u.id, { secondFactor: how, recoveryCodesLeft: how === "recovery" ? u.recoveryCodes.length - 1 : undefined });
  return json({ ok: true, recoveryCodesLeft: how === "recovery" ? u.recoveryCodes.length - 1 : undefined });
});
