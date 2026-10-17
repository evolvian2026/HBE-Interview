import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { base32Decode, newRecoveryCodes, verifyTotp } from "../core/totp";
import { sha256, unseal } from "./secrets";

const norm = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Check a TOTP code (no replay within its window) or a single-use recovery code for a user with 2FA enabled.
 * Consumes the recovery code / records the TOTP step on success.
 */
export async function checkSecondFactor(user: typeof schema.users.$inferSelect, code: string): Promise<"totp" | "recovery" | null> {
  if (!user.totpSecret || !user.totpEnabledAt) return null;
  const step = verifyTotp(base32Decode(unseal(user.totpSecret)), code, Date.now(), user.totpLastStep);
  if (step != null) {
    await db.update(schema.users).set({ totpLastStep: step }).where(eq(schema.users.id, user.id));
    return "totp";
  }
  const h = sha256(norm(code));
  if (norm(code).length === 8 && user.recoveryCodes.includes(h)) {
    await db
      .update(schema.users)
      .set({ recoveryCodes: user.recoveryCodes.filter((x) => x !== h) })
      .where(eq(schema.users.id, user.id));
    return "recovery";
  }
  return null;
}

/** Fresh recovery codes: plaintext for the user (shown once), hashes for storage. */
export function issueRecoveryCodes() {
  const codes = newRecoveryCodes();
  return { codes, hashes: codes.map((c) => sha256(norm(c))) };
}
