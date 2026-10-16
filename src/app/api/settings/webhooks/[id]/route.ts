import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { HttpError, requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { audit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({ active: z.boolean() });

export const PUT = handle(async (req: Request, { params }: Ctx) => {
  const user = await requireStaff("admin");
  const { id } = await params;
  const { active } = Body.parse(await req.json());
  const done = await db.update(schema.webhooks).set({ active }).where(and(eq(schema.webhooks.id, id), eq(schema.webhooks.orgId, user.orgId))).returning({ id: schema.webhooks.id });
  if (!done.length) throw new HttpError(404, "Webhook not found");
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, active ? "webhook.enable" : "webhook.disable", "webhook", id);
  return json({ ok: true });
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const user = await requireStaff("admin");
  const { id } = await params;
  const gone = await db.delete(schema.webhooks).where(and(eq(schema.webhooks.id, id), eq(schema.webhooks.orgId, user.orgId))).returning({ id: schema.webhooks.id });
  if (!gone.length) throw new HttpError(404, "Webhook not found");
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "webhook.delete", "webhook", id);
  return json({ ok: true });
});
