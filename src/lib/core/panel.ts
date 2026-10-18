/** Panel interviews (pure): default competencies, slot rules and scorecard aggregation. */
import { isHireSide } from "./calibration";
import { recRank } from "./scoring";
import type { DriveConfig, Recommendation } from "./types";

export const MAX_SLOTS = 5;
export const MAX_COMPETENCIES = 8;
/** Spread (max − min) on a competency at which the panel is considered split. */
export const SPLIT_SPREAD = 2;

/** Sensible competencies for a final panel, from the role's profile. */
export function defaultCompetencies(config: Pick<DriveConfig, "roleProfile">): string[] {
  const p = config.roleProfile;
  const out: string[] = [];
  if (p.category === "coding") out.push("Technical depth", "Problem solving", "System design");
  else if (p.category === "technical_non_coding") out.push("Domain expertise", "Problem solving");
  else out.push("Functional expertise", "Judgement");
  if (p.track === "manager" || ["lead", "manager", "director"].includes(p.seniority)) out.push("Leadership");
  out.push("Communication", "Collaboration", "Motivation & role fit");
  return out.slice(0, MAX_COMPETENCIES);
}

/** Offered slots must be distinct, in the future (with a little slack) and within a year. */
export function slotProblem(slots: string[], now = new Date()): string | null {
  if (!slots.length) return "Offer at least one time.";
  if (slots.length > MAX_SLOTS) return `Offer at most ${MAX_SLOTS} times.`;
  const ts = slots.map((s) => Date.parse(s));
  if (ts.some((t) => Number.isNaN(t))) return "One of the times isn't a valid date.";
  if (ts.some((t) => t < now.getTime() + 5 * 60_000)) return "Times must be in the future.";
  if (ts.some((t) => t > now.getTime() + 366 * 86_400_000)) return "Times must be within the next year.";
  if (new Set(ts).size !== ts.length) return "The same time is offered twice.";
  return null;
}

export interface Scorecard {
  ratings: Record<string, number> | null;
  recommendation: string | null;
  submittedAt: Date | string | null;
}

export interface CompetencySummary {
  competency: string;
  n: number;
  mean: number | null;
  min: number | null;
  max: number | null;
  split: boolean;
}

export interface PanelSummary {
  submitted: number;
  pending: number;
  competencies: CompetencySummary[];
  recommendations: Record<Recommendation, number>;
  /** Recommendations fall on both sides of the hire line, or a competency spread ≥ 2. */
  split: boolean;
  /** Most common recommendation; ties go to the more cautious one. */
  consensus: Recommendation | null;
  hireVotes: number;
}

export function summarisePanel(competencies: string[], cards: Scorecard[]): PanelSummary {
  const done = cards.filter((c) => c.submittedAt);
  const comps = competencies.map((competency) => {
    const vals = done.map((c) => c.ratings?.[competency]).filter((v): v is number => typeof v === "number");
    const min = vals.length ? Math.min(...vals) : null;
    const max = vals.length ? Math.max(...vals) : null;
    return { competency, n: vals.length, mean: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null, min, max, split: min != null && max != null && max - min >= SPLIT_SPREAD };
  });
  const recommendations: Record<Recommendation, number> = { strong_hire: 0, hire: 0, lean_no: 0, no_hire: 0 };
  for (const c of done) if (c.recommendation && c.recommendation in recommendations) recommendations[c.recommendation as Recommendation]++;
  const recs = (Object.keys(recommendations) as Recommendation[]).filter((r) => recommendations[r] > 0);
  const hireVotes = recs.filter(isHireSide).reduce((a, r) => a + recommendations[r], 0);
  const consensus = recs.length ? recs.sort((a, b) => recommendations[b] - recommendations[a] || recRank(a) - recRank(b))[0] : null;
  const sides = new Set(recs.map(isHireSide));
  return {
    submitted: done.length,
    pending: cards.length - done.length,
    competencies: comps,
    recommendations,
    split: sides.size > 1 || comps.some((c) => c.split),
    consensus,
    hireVotes,
  };
}
