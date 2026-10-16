import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { audit } from "@/lib/audit";
import { WEBHOOK_EVENTS, createWebhook } from "@/lib/services/integrations";

const Body = z.object({ url: z.string().trim().min(8).max(2000), events: z.array(z.enum(WEBHOOK_EVENTS)).min(1) });

/** Register a webhook endpoint — the signing secret is returned once. */
export const POST = handle(async (req: Request) => {
  const user = await requireStaff("admin");
  const { url, events } = Body.parse(await req.json());
  const out = await createWebhook(url, [...new Set(events)], user.id);
  await audit({ type: "staff", id: user.id }, "webhook.create", "webhook", out.id, { url, events });
  return json(out, 201);
});
