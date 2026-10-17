import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { createMfaChallenge, createStaffSession, ensureBootstrapAdmin, HttpError, verifyPassword } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { audit } from "@/lib/audit";
import { clientIp, limit, resetLimit } from "@/lib/security/rate-limit";
import { passwordBlockedBySso } from "@/lib/services/sso";

const Body = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;
const GENERIC = "Invalid email or password";

export const POST = handle(async (req: Request) => {
  await ensureBootstrapAdmin();
  const { email, password } = Body.parse(await req.json());
  const addr = email.toLowerCase();
  // Throttle by client and by account (shared across app instances).
  await limit(`login:ip:${clientIp(req)}`, 100, 15 * 60);
  await limit(`login:email:${addr}`, 10, 15 * 60, "Too many sign-in attempts for this account. Try again in 15 minutes.");
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, addr));
  if (u?.lockedUntil && u.lockedUntil > new Date()) throw new HttpError(429, "Too many sign-in attempts for this account. Try again in 15 minutes.");
  if (!u || !u.active || !(await verifyPassword(password, u.passwordHash))) {
    if (u) {
      const failures = u.failedLogins + 1;
      await db
        .update(schema.users)
        .set({ failedLogins: failures >= MAX_FAILURES ? 0 : failures, ...(failures >= MAX_FAILURES ? { lockedUntil: sql`now() + interval '${sql.raw(String(LOCK_MINUTES))} minutes'` } : {}) })
        .where(eq(schema.users.id, u.id));
      await audit({ type: "staff", id: u.id, orgId: u.orgId }, failures >= MAX_FAILURES ? "auth.locked" : "auth.failed", "user", u.id);
    }
    throw new HttpError(401, GENERIC);
  }
  if (await passwordBlockedBySso(u)) return json({ error: { message: "Your organisation signs in with single sign-on." }, sso: true }, 409);
  const [org] = await db.select({ status: schema.organizations.status }).from(schema.organizations).where(eq(schema.organizations.id, u.orgId));
  if (org?.status !== "active" && !u.platformAdmin) throw new HttpError(403, "Your organisation's account is suspended. Please contact support.");
  await db.update(schema.users).set({ failedLogins: 0, lockedUntil: null }).where(eq(schema.users.id, u.id));
  await resetLimit(`login:email:${addr}`);
  if (u.totpEnabledAt) {
    await createMfaChallenge(u);
    return json({ twoFactor: true });
  }
  await createStaffSession(u);
  await audit({ type: "staff", id: u.id, orgId: u.orgId }, "auth.login", "user", u.id);
  return json({ ok: true });
});
