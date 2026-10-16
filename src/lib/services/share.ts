import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { db, schema } from "../db";
import { env } from "../env";
import { audit } from "../audit";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const key = () => new TextEncoder().encode(env.sessionSecret);

export async function createShareLink(candidacyId: string, userId: string, opts: { days: number; passcode?: string; masked: boolean }) {
  const token = randomBytes(24).toString("base64url");
  const [link] = await db
    .insert(schema.shareLinks)
    .values({
      candidacyId,
      tokenHash: sha(token),
      passcodeHash: opts.passcode ? await bcrypt.hash(opts.passcode, 10) : null,
      masked: opts.masked,
      expiresAt: new Date(Date.now() + opts.days * 86_400_000),
      createdBy: userId,
    })
    .returning();
  await audit({ type: "staff", id: userId }, "share.create", "candidacy", candidacyId, { linkId: link.id, days: opts.days, masked: opts.masked, passcode: !!opts.passcode });
  return { link, url: `${env.appBaseUrl.replace(/\/$/, "")}/r/${token}` };
}

/** Active (non-expired, non-revoked) link for a token, or null. */
export async function resolveShareLink(token: string) {
  if (!token || token.length < 20) return null;
  const [link] = await db
    .select()
    .from(schema.shareLinks)
    .where(and(eq(schema.shareLinks.tokenHash, sha(token)), isNull(schema.shareLinks.revokedAt), gt(schema.shareLinks.expiresAt, new Date())));
  return link ?? null;
}

const cookieName = (linkId: string) => `hbe_sh_${linkId.slice(0, 8)}`;

export async function unlockShareLink(token: string, passcode: string) {
  const link = await resolveShareLink(token);
  if (!link?.passcodeHash) return false;
  if (!(await bcrypt.compare(passcode, link.passcodeHash))) return false;
  const jwt = await new SignJWT({ l: link.id }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("2h").sign(key());
  (await cookies()).set(cookieName(link.id), jwt, { httpOnly: true, sameSite: "lax", secure: env.isProduction, path: "/r", maxAge: 7200 });
  return true;
}

export async function isUnlocked(link: typeof schema.shareLinks.$inferSelect) {
  if (!link.passcodeHash) return true;
  const c = (await cookies()).get(cookieName(link.id))?.value;
  if (!c) return false;
  try {
    const { payload } = await jwtVerify(c, key());
    return payload.l === link.id;
  } catch {
    return false;
  }
}

export async function recordShareView(linkId: string, candidacyId: string) {
  await db.update(schema.shareLinks).set({ views: sql`${schema.shareLinks.views} + 1` }).where(eq(schema.shareLinks.id, linkId));
  await audit({ type: "system", id: linkId }, "share.view", "candidacy", candidacyId);
}
