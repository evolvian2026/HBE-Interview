import { z } from "zod";
import { structured, untrusted, type CallContext } from "./gateway";

export const CandidateFeedbackSchema = z.object({
  /** 2–4 things the candidate did well, phrased to them ("You …"). */
  strengths: z.array(z.string()),
  /** 2–4 concrete, constructive areas to develop. */
  growthAreas: z.array(z.string()),
  /** ≤ 60-word closing note. */
  note: z.string(),
});
export type CandidateFeedbackSummary = z.infer<typeof CandidateFeedbackSchema>;

/**
 * Draft a candidate-facing feedback summary from the (internal) round reports. A recruiter reviews and
 * edits it before release; it never contains scores, recommendations, integrity flags or hiring decisions.
 */
export async function draftCandidateFeedback(input: { roleTitle: string; roundsText: string; ctx: CallContext }): Promise<CandidateFeedbackSummary> {
  return structured({
    stage: "candidate_feedback",
    tier: "utility",
    system: `You turn an internal interview evaluation into short, kind, specific developmental feedback addressed directly to the candidate ("You …").
Rules:
- 2–4 strengths and 2–4 growth areas, each one sentence, grounded in what the reports say the candidate actually did. Growth areas must be actionable (what to practise or read up on).
- Never mention scores, ratings, recommendations, hire/no-hire, rankings, other candidates, the hiring decision, integrity or proctoring signals, AI-generated-answer checks, compensation, notice period, or anything about protected characteristics.
- Do not promise next steps. note: ≤ 60 words, thank them and encourage them.`,
    user: `## Role\n${input.roleTitle}\n\n## Internal round reports\n${untrusted("reports", input.roundsText)}`,
    schema: CandidateFeedbackSchema,
    maxTokens: 2000,
    ctx: input.ctx,
    mock: () => ({
      strengths: ["You explained your reasoning step by step and checked your assumptions out loud."],
      growthAreas: ["Practise discussing trade-offs (time vs. space, consistency vs. availability) before settling on a design."],
      note: "Thank you for the time and care you put into the interview. We hope this feedback is useful wherever your next step takes you.",
    }),
  });
}
