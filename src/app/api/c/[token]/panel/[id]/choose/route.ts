import { z } from "zod";
import { requireCandidacy } from "@/lib/auth/candidate";
import { handle, json } from "@/lib/http";
import { limit } from "@/lib/security/rate-limit";
import { chooseSlot } from "@/lib/services/panel";

const Body = z.object({ slot: z.string().max(40) });

export const POST = handle(async (req: Request, { params }: { params: Promise<{ token: string; id: string }> }) => {
  const { token, id } = await params;
  const { candidacy } = await requireCandidacy(token);
  await limit(`panel:${candidacy.id}`, 20, 60 * 60);
  const iv = await chooseSlot(candidacy, id, Body.parse(await req.json()).slot);
  return json({ scheduledAt: iv.scheduledAt });
});
