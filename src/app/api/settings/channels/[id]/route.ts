import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { deleteChannel, updateChannel } from "@/lib/services/channels";
import { CHANNEL_EVENT_KEYS, type ChannelEvent } from "@/lib/core/notifications";

const Body = z.object({ active: z.boolean().optional(), includeNames: z.boolean().optional(), events: z.array(z.enum(CHANNEL_EVENT_KEYS as [string, ...string[]])).optional() });

export const PATCH = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("admin");
  const b = Body.parse(await req.json());
  await updateChannel(user, (await params).id, { ...b, events: b.events as ChannelEvent[] | undefined });
  return json({ ok: true });
});

export const DELETE = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("admin");
  await deleteChannel(user, (await params).id);
  return json({ ok: true });
});
