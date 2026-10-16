import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { HttpError, requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { enqueue } from "@/lib/jobs/queue";

/** Queue a signed `ping` delivery to one webhook so the receiver can verify its signature check. */
export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("admin");
  const { id } = await params;
  const [hook] = await db.select().from(schema.webhooks).where(and(eq(schema.webhooks.id, id), eq(schema.webhooks.orgId, user.orgId)));
  if (!hook) throw new HttpError(404, "Webhook not found");
  const [d] = await db
    .insert(schema.webhookDeliveries)
    .values({ webhookId: id, event: "ping", payload: { event: "ping", createdAt: new Date().toISOString(), data: { message: "HBE Interview webhook test" } } })
    .returning({ id: schema.webhookDeliveries.id });
  await enqueue("deliver-webhook", { deliveryId: d.id }, { singletonKey: `wh:${d.id}`, maxAttempts: 1 });
  return json({ deliveryId: d.id }, 202);
});
