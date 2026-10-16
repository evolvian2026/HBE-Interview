import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { HttpError, hashPassword, requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { audit } from "@/lib/audit";

const Body = z.object({
  role: z.enum(["admin", "recruiter", "hiring_manager", "viewer"]).optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).max(200).optional(),
  driveIds: z.array(z.string().uuid()).max(500).optional(),
});

export const PUT = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const admin = await requireStaff("admin");
  const { id } = await params;
  const b = Body.parse(await req.json());
  if (id === admin.id && (b.active === false || (b.role && b.role !== "admin"))) throw new HttpError(400, "You can't deactivate or demote yourself");
  await db
    .update(schema.users)
    .set({ ...(b.role ? { role: b.role } : {}), ...(b.active !== undefined ? { active: b.active } : {}), ...(b.password ? { passwordHash: await hashPassword(b.password) } : {}), ...(b.driveIds ? { driveIds: b.driveIds } : {}) })
    .where(eq(schema.users.id, id));
  await audit({ type: "staff", id: admin.id }, "user.update", "user", id, { role: b.role, active: b.active, password: !!b.password, driveIds: b.driveIds });
  return json({ ok: true });
});
