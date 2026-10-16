import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { audit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({ active: z.boolean() });

export const PUT = handle(async (req: Request, { params }: Ctx) => {
  const user = await requireStaff("admin");
  const { id } = await params;
  const { active } = Body.parse(await req.json());
  await db.update(schema.webhooks).set({ active }).where(eq(schema.webhooks.id, id));
  await audit({ type: "staff", id: user.id }, active ? "webhook.enable" : "webhook.disable", "webhook", id);
  return json({ ok: true });
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const user = await requireStaff("admin");
  const { id } = await params;
  await db.delete(schema.webhooks).where(eq(schema.webhooks.id, id));
  await audit({ type: "staff", id: user.id }, "webhook.delete", "webhook", id);
  return json({ ok: true });
});
