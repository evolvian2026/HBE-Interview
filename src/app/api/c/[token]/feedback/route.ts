import { z } from "zod";
import { requireCandidacy } from "@/lib/auth/candidate";
import { handle, json } from "@/lib/http";
import { submitSurvey } from "@/lib/services/feedback";

const rating = z.number().int().min(1).max(5);
const Body = z.object({
  roundIndex: z.number().int().min(0).max(10),
  overall: rating,
  fairness: rating.nullish(),
  clarity: rating.nullish(),
  technical: rating.nullish(),
  comment: z.string().max(2000).nullish(),
});

/** Post-round candidate experience survey (one per round; optional for the candidate). */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ token: string }> }) => {
  const { token } = await params;
  const { candidacy } = await requireCandidacy(token);
  await submitSurvey(candidacy.id, Body.parse(await req.json()));
  return json({ ok: true }, 201);
});
