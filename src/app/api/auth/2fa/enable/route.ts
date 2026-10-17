import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { HttpError, requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { audit } from "@/lib/audit";
import { base32Decode, verifyTotp } from "@/lib/core/totp";
import { unseal } from "@/lib/security/secrets";
import { issueRecoveryCodes } from "@/lib/security/two-factor";
import { limit } from "@/lib/security/rate-limit";

const Body = z.object({ code: z.string().trim().min(6).max(10) });

/** Confirm enrolment with a code from the app; returns one-time recovery codes. */
export const POST = handle(async (req: Request) => {
  const user = await requireStaff("viewer", { allowEnrollment: true });
  await limit(`2fa-enable:${user.id}`, 10, 15 * 60);
  const { code } = Body.parse(await req.json());
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
  if (u.totpEnabledAt) throw new HttpError(409, "Two-factor sign-in is already on");
  if (!u.totpSecret) throw new HttpError(400, "Start setup first");
  const step = verifyTotp(base32Decode(unseal(u.totpSecret)), code);
  if (step == null) throw new HttpError(400, "That code didn't match. Check the time on your phone and try the current code.");
  const { codes, hashes } = issueRecoveryCodes();
  await db.update(schema.users).set({ totpEnabledAt: new Date(), totpLastStep: step, recoveryCodes: hashes }).where(eq(schema.users.id, u.id));
  await audit({ type: "staff", id: u.id, orgId: u.orgId }, "auth.2fa_enabled", "user", u.id);
  return json({ recoveryCodes: codes });
});
