import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { createChannel } from "@/lib/services/channels";
import { CHANNEL_EVENT_KEYS } from "@/lib/core/notifications";

const Body = z.object({
  kind: z.enum(["slack", "teams"]),
  name: z.string().trim().min(1).max(80),
  url: z.string().trim().min(10).max(2000),
  events: z.array(z.enum(CHANNEL_EVENT_KEYS as [string, ...string[]])).min(1),
  includeNames: z.boolean().default(false),
});

/** Add a Slack or Teams channel (admins). */
export const POST = handle(async (req: Request) => {
  const user = await requireStaff("admin");
  const b = Body.parse(await req.json());
  return json({ id: await createChannel(user, b as Parameters<typeof createChannel>[1]) }, 201);
});
