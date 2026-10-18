/**
 * Practice interviews (pure): a short, unscored warm-up with the AI interviewer so candidates can try the format,
 * the voice/text controls and the pace before their real rounds. Stored as a round session with index -1.
 * The last section uses the standard "wrapup" key so the usual wrap-up, closing and time-up handling applies.
 */
import type { DriveConfig, RoundConfig } from "./types";

export const PRACTICE_INDEX = -1;
export const PRACTICE_MINUTES = 6;

export const isPractice = (roundIndex: number) => roundIndex < 0;

/** The practice round: warm-up, one sample question in the style of the real interview, and tips. */
export function practiceRound(config: Pick<DriveConfig, "rounds">): RoundConfig {
  const persona = config.rounds.find((r) => r.enabled)?.personaName ?? "Aria";
  return {
    type: "hr",
    enabled: true,
    durationMin: PRACTICE_MINUTES,
    personaName: persona,
    sections: [
      { key: "practice_intro", title: "Warm-up", minutes: 2, minQ: 1, maxQ: 2, enabled: true },
      { key: "practice_sample", title: "Sample question", minutes: 3, minQ: 1, maxQ: 3, enabled: true },
      { key: "wrapup", title: "Tips & wrap-up", minutes: 1, minQ: 0, maxQ: 1, enabled: true },
    ],
    pinnedQuestions: [],
    weights: { motivation: 50, behavioral: 50 },
    gate: { mode: "always", threshold: "hire" },
  };
}

/** A sample question in the spirit of the role, never one from the real interview. */
export function practiceQuestion(config: Pick<DriveConfig, "roleProfile">): string {
  const p = config.roleProfile;
  if (p.category === "coding") return "Tell me about a technical problem you solved recently: what was the problem, what options did you consider, and what did you choose?";
  if (p.category === "technical_non_coding") return "Walk me through a piece of work in your field you're proud of: what was the goal, what did you do, and what was the outcome?";
  if (p.track === "manager") return "Tell me about a time you helped your team through a difficult period: what was happening, what did you do, and what changed?";
  return "Tell me about a recent piece of work you're proud of: what was the goal, what was your part, and what was the outcome?";
}

export const PRACTICE_INSTRUCTION =
  "This is an UNSCORED PRACTICE session that helps the candidate get comfortable with the format before their real interview. Be warm and encouraging and keep turns short. Nothing here is evaluated or shared with the hiring team as a score. Do not ask about compensation or personal circumstances. In the Tips section, give one or two friendly, general tips on answering (structure, specific examples, it's fine to ask for clarification or take a moment to think), then call end_interview.";

export const PRACTICE_GUIDE: Record<string, { objective: string; param: string }> = {
  practice_intro: {
    objective: "Greet the candidate, explain this is a short unscored practice run (about 6 minutes) to try the format, and ask an easy warm-up question about what they enjoy in their work.",
    param: "motivation",
  },
  practice_sample: {
    objective: "Ask the sample question from the suggestions, then ask one natural follow-up — just like the real interview would — and acknowledge their answer briefly.",
    param: "behavioral",
  },
  wrapup: {
    objective: "Give one or two friendly, general tips on answering, wish them luck for the real interview, and call end_interview.",
    param: "behavioral",
  },
};
