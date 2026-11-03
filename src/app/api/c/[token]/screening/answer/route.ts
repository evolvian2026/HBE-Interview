import { z } from "zod";
import { requireCandidacy } from "@/lib/auth/candidate";
import { handle, json } from "@/lib/http";
import { saveAnswer } from "@/lib/services/screening";

const Body = z.object({ qid: z.string().min(1).max(80), choice: z.number().int().min(0).max(9).nullable() });

export const PUT = handle(async (req: Request, { params }: { params: Promise<{ token: string }> }) => {
  const { candidacy } = await requireCandidacy((await params).token);
  const b = Body.parse(await req.json());
  return json(await saveAnswer(candidacy, b.qid, b.choice));
});
