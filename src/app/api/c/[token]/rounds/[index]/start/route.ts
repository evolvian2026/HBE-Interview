import { z } from "zod";
import { requireCandidacy } from "@/lib/auth/candidate";
import { handle, json } from "@/lib/http";
import { startRound } from "@/lib/interview/orchestrator";

const Body = z.object({ mode: z.enum(["text", "voice"]) });

export const POST = handle(async (req: Request, { params }: { params: Promise<{ token: string; index: string }> }) => {
  const { token, index } = await params;
  const { candidacy } = await requireCandidacy(token);
  const s = await startRound(candidacy.id, Number(index), Body.parse(await req.json()).mode);
  return json({ sessionId: s.id });
});
