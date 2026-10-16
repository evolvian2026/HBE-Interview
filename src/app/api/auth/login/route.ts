import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { createStaffSession, ensureBootstrapAdmin, HttpError, verifyPassword } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { audit } from "@/lib/audit";

const Body = z.object({ email: z.string().email(), password: z.string().min(1) });

export const POST = handle(async (req: Request) => {
  await ensureBootstrapAdmin();
  const { email, password } = Body.parse(await req.json());
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, email.toLowerCase()));
  if (!u || !u.active || !(await verifyPassword(password, u.passwordHash))) throw new HttpError(401, "Invalid email or password");
  const [org] = await db.select({ status: schema.organizations.status }).from(schema.organizations).where(eq(schema.organizations.id, u.orgId));
  if (org?.status !== "active" && !u.platformAdmin) throw new HttpError(403, "Your organisation's account is suspended. Please contact support.");
  await createStaffSession({ id: u.id, role: u.role });
  await audit({ type: "staff", id: u.id, orgId: u.orgId }, "auth.login", "user", u.id);
  return json({ ok: true });
});
