import { z } from "zod";
import { requireStaff, assertCandidacyAccess } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { CandidateFeedbackSchema } from "@/lib/ai/feedback";
import { draftFeedbackSummary, saveFeedbackSummary } from "@/lib/services/feedback";

type Ctx = { params: Promise<{ id: string }> };

/** Draft the candidate-facing feedback summary with AI (not visible to the candidate until released). */
export const POST = handle(async (_req: Request, { params }: Ctx) => {
  const user = await requireStaff("recruiter");
  const { id } = await params;
  await assertCandidacyAccess(user, id);
  return json({ summary: await draftFeedbackSummary(id, user.id) });
});

const line = z.string().trim().min(1).max(400);
const Body = z.object({
  summary: CandidateFeedbackSchema.extend({ strengths: z.array(line).max(6), growthAreas: z.array(line).max(6), note: z.string().trim().max(600) }),
  release: z.boolean(),
});

/** Save recruiter edits; `release: true` shows it on the candidate's page, `false` withdraws it. */
export const PUT = handle(async (req: Request, { params }: Ctx) => {
  const user = await requireStaff("recruiter");
  const { id } = await params;
  await assertCandidacyAccess(user, id);
  const { summary, release } = Body.parse(await req.json());
  await saveFeedbackSummary(id, summary, release, user.id);
  return json({ ok: true });
});
