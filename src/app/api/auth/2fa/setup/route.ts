import { eq } from "drizzle-orm";
import QRCode from "qrcode";
import { db, schema } from "@/lib/db";
import { HttpError, requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { newTotpSecret, otpauthUri } from "@/lib/core/totp";
import { seal } from "@/lib/security/secrets";

/** Start two-factor enrolment: a new secret (stored sealed, not yet active) and its QR code. */
export const POST = handle(async () => {
  const user = await requireStaff("viewer", { allowEnrollment: true });
  if (user.has2fa) throw new HttpError(409, "Two-factor sign-in is already on");
  const secret = newTotpSecret();
  await db.update(schema.users).set({ totpSecret: seal(secret), totpEnabledAt: null }).where(eq(schema.users.id, user.id));
  const uri = otpauthUri(secret, user.email);
  return json({ secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) });
});
