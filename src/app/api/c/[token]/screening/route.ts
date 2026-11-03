import { requireCandidacy } from "@/lib/auth/candidate";
import { handle, json } from "@/lib/http";
import { publicPaper, screeningState } from "@/lib/services/screening";

/** The candidate's test: status and, once started, their questions (never the answers). */
export const GET = handle(async (_req: Request, { params }: { params: Promise<{ token: string }> }) => {
  const { candidacy } = await requireCandidacy((await params).token);
  const s = await screeningState(candidacy);
  if (!s.required) return json({ required: false });
  return json({ required: true, status: s.status, durationMin: s.cfg.durationMin, paper: s.attempt && !s.attempt.submittedAt ? publicPaper(s.attempt) : null });
});
