import { z } from "zod";
import { requireCandidacy } from "@/lib/auth/candidate";
import { handle, json } from "@/lib/http";
import { limit } from "@/lib/security/rate-limit";
import { requestOtherTimes } from "@/lib/services/panel";

const Body = z.object({ message: z.string().max(1000).default("") });

export const POST = handle(async (req: Request, { params }: { params: Promise<{ token: string; id: string }> }) => {
  const { token, id } = await params;
  const { candidacy } = await requireCandidacy(token);
  await limit(`panel:${candidacy.id}`, 20, 60 * 60);
  await requestOtherTimes(candidacy, id, Body.parse(await req.json()).message);
  return json({ ok: true });
});
