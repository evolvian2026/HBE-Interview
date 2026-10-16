import { z } from "zod";
import { requireCandidacy } from "@/lib/auth/candidate";
import { handle, json } from "@/lib/http";
import { startRound } from "@/lib/interview/orchestrator";

const Body = z.object({ mode: z.enum(["text", "voice"]), language: z.string().max(5).optional() });

export const POST = handle(async (req: Request, { params }: { params: Promise<{ token: string; index: string }> }) => {
  const { token, index } = await params;
  const { candidacy } = await requireCandidacy(token);
  const b = Body.parse(await req.json());
  const s = await startRound(candidacy.id, Number(index), b.mode, b.language ?? "en");
  return json({ sessionId: s.id });
});
