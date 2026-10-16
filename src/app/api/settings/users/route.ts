import { z } from "zod";
import { db, schema } from "@/lib/db";
import { hashPassword, requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { audit } from "@/lib/audit";

const Body = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(200),
  role: z.enum(["admin", "recruiter", "hiring_manager", "viewer"]),
});

export const POST = handle(async (req: Request) => {
  const admin = await requireStaff("admin");
  const b = Body.parse(await req.json());
  const [u] = await db
    .insert(schema.users)
    .values({ orgId: admin.orgId, name: b.name, email: b.email.toLowerCase(), passwordHash: await hashPassword(b.password), role: b.role })
    .onConflictDoNothing()
    .returning();
  if (!u) return json({ error: { message: "A user with this email already exists" } }, 409);
  await audit({ type: "staff", id: admin.id, orgId: admin.orgId }, "user.create", "user", u.id, { role: b.role });
  return json({ id: u.id });
});
