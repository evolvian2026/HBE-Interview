import { requireCandidacy } from "@/lib/auth/candidate";
import { handle, json } from "@/lib/http";
import { screeningState, submitAttempt } from "@/lib/services/screening";
import type { ScreeningScore } from "@/lib/core/screening";

/** Hand in the test. The candidate sees their score only if the drive allows it. */
export const POST = handle(async (_req: Request, { params }: { params: Promise<{ token: string }> }) => {
  const { candidacy } = await requireCandidacy((await params).token);
  const a = await submitAttempt(candidacy, "submitted");
  const s = await screeningState(candidacy);
  return json({ status: s.required ? s.status : "passed", score: s.cfg.showScore ? { percent: a.percent, correct: (a.score as ScreeningScore | null)?.correct, total: (a.score as ScreeningScore | null)?.total } : null });
});
