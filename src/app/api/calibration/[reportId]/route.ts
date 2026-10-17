import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { submitReview } from "@/lib/services/calibration";

const Body = z.object({
  scores: z.record(z.string(), z.number().int().min(1).max(5).nullable()),
  recommendation: z.enum(["strong_hire", "hire", "lean_no", "no_hire"]),
  notes: z.string().max(4000).optional(),
});

/** Submit a blind review; the response reveals the AI's scores for comparison. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ reportId: string }> }) => {
  const user = await requireStaff("hiring_manager");
  const { reportId } = await params;
  const r = await submitReview(user, reportId, Body.parse(await req.json()));
  return json({ id: r.review.id, disagrees: r.comparison.disagrees, comparison: r.comparison, ai: r.ai }, 201);
});
