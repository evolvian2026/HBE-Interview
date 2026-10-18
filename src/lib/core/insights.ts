/** Hiring insights (pure): funnel conversion, durations, AI vs final decision, and agreement between panelists. */
import { isHireSide } from "./calibration";
import type { Recommendation } from "./types";

export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export const days = (from: Date | string, to: Date | string) => (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000;

export interface FunnelStep {
  label: string;
  value: number;
  /** Share of the previous step that reached this one. */
  fromPrevious: number | null;
  /** Share of the first step. */
  fromStart: number | null;
}

export function funnel(steps: { label: string; value: number }[]): FunnelStep[] {
  return steps.map((s, i) => ({
    ...s,
    fromPrevious: i === 0 ? null : steps[i - 1].value ? s.value / steps[i - 1].value : null,
    fromStart: i === 0 ? null : steps[0].value ? s.value / steps[0].value : null,
  }));
}

export interface AiDecisionAgreement {
  n: number;
  agree: number;
  /** The AI recommended hiring but people rejected. */
  aiHireRejected: number;
  /** The AI recommended against hiring but people made an offer. */
  aiNoOffered: number;
  rate: number | null;
}

/** How often people's final call matched the AI's combined recommendation (holds excluded). */
export function aiVsDecision(pairs: { ai: Recommendation; decision: "offer" | "reject" }[]): AiDecisionAgreement {
  let agree = 0;
  let aiHireRejected = 0;
  let aiNoOffered = 0;
  for (const p of pairs) {
    const aiHire = isHireSide(p.ai);
    if (aiHire === (p.decision === "offer")) agree++;
    else if (aiHire) aiHireRejected++;
    else aiNoOffered++;
  }
  return { n: pairs.length, agree, aiHireRejected, aiNoOffered, rate: pairs.length ? agree / pairs.length : null };
}

export interface PanelCards {
  competencies: string[];
  cards: { ratings: Record<string, number> | null; recommendation: string | null }[];
}

export interface PanelAgreement {
  interviews: number;
  ratingPairs: number;
  exact: number | null;
  withinOne: number | null;
  recommendationPairs: number;
  sameSide: number | null;
  /** Average (max − min) per competency across interviews. */
  meanSpread: number | null;
}

/** Agreement between people on the same panel: every pair of submitted scorecards, per competency. */
export function panelAgreement(panels: PanelCards[]): PanelAgreement {
  let interviews = 0;
  let ratingPairs = 0;
  let exact = 0;
  let within = 0;
  let recPairs = 0;
  let same = 0;
  const spreads: number[] = [];
  for (const p of panels) {
    const cards = p.cards.filter((c) => c.ratings && c.recommendation);
    if (cards.length < 2) continue;
    interviews++;
    for (let i = 0; i < cards.length; i++)
      for (let j = i + 1; j < cards.length; j++) {
        for (const comp of p.competencies) {
          const a = cards[i].ratings![comp];
          const b = cards[j].ratings![comp];
          if (typeof a !== "number" || typeof b !== "number") continue;
          ratingPairs++;
          if (a === b) exact++;
          if (Math.abs(a - b) <= 1) within++;
        }
        recPairs++;
        if (isHireSide(cards[i].recommendation as Recommendation) === isHireSide(cards[j].recommendation as Recommendation)) same++;
      }
    for (const comp of p.competencies) {
      const vals = cards.map((c) => c.ratings![comp]).filter((v): v is number => typeof v === "number");
      if (vals.length >= 2) spreads.push(Math.max(...vals) - Math.min(...vals));
    }
  }
  return {
    interviews,
    ratingPairs,
    exact: ratingPairs ? exact / ratingPairs : null,
    withinOne: ratingPairs ? within / ratingPairs : null,
    recommendationPairs: recPairs,
    sameSide: recPairs ? same / recPairs : null,
    meanSpread: spreads.length ? spreads.reduce((a, b) => a + b, 0) / spreads.length : null,
  };
}

/* ------------------------------- Talent pool ------------------------------ */

export const POOL_MONTHS = [6, 12, 24] as const;

/** Normalise recruiter tags: trimmed, lower-case, unique, at most 12 of up to 30 characters. */
export function normaliseTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().toLowerCase().replace(/\s+/g, " ")).filter((t) => t && t.length <= 30))].slice(0, 12);
}
