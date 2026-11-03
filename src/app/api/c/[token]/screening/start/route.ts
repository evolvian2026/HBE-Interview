import { requireCandidacy } from "@/lib/auth/candidate";
import { handle, json } from "@/lib/http";
import { publicPaper, startAttempt } from "@/lib/services/screening";

/** Start the clock (or resume an attempt in progress). */
export const POST = handle(async (_req: Request, { params }: { params: Promise<{ token: string }> }) => {
  const { candidacy } = await requireCandidacy((await params).token);
  return json(publicPaper(await startAttempt(candidacy)));
});
