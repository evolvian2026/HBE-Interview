/**
 * Quality of hire (pure): how well what the interview said predicts how hires actually do. Managers rate each hire
 * at 90 and 180 days; these functions relate the interview signals frozen at the offer to those ratings.
 */
import type { Recommendation } from "./types";

export const CHECKPOINTS = [90, 180] as const;
export type Checkpoint = (typeof CHECKPOINTS)[number];
/** Below this many rated hires a relationship is shown but described as too early to tell. */
export const MIN_HIRES = 10;
/** Remind the reviewer at most this often. */
export const REMIND_EVERY_DAYS = 7;

/** Interview signals frozen when the offer was recorded. */
export interface HireSnapshot {
  finalScore: number | null;
  aiRecommendation: Recommendation | null;
  roundScores: Partial<Record<"technical" | "managerial" | "hr", number>>;
  /** Share of submitted panel scorecards on the hire side (0–1), when there was a panel. */
  panelHireShare: number | null;
}

export interface HireOutcome {
  snapshot: HireSnapshot;
  /** The latest submitted review's overall rating (1–5), if any. */
  rating: number | null;
  wouldRehire: "yes" | "no" | "unsure" | null;
  /** Left within the first 90 days of joining. */
  leftEarly: boolean;
  joined: boolean;
}

export function dueDate(joinedAt: Date, checkpoint: Checkpoint) {
  return new Date(joinedAt.getTime() + checkpoint * 86_400_000);
}

/** Average ranks (ties share the mean rank). */
function ranks(xs: number[]): number[] {
  const order = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(xs.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    for (let k = i; k <= j; k++) r[order[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}

/** Spearman rank correlation (−1…1); null with fewer than 3 pairs or no spread. */
export function spearman(pairs: [number, number][]): number | null {
  if (pairs.length < 3) return null;
  const rx = ranks(pairs.map((p) => p[0]));
  const ry = ranks(pairs.map((p) => p[1]));
  const n = pairs.length;
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  if (!dx || !dy) return null;
  return Math.round((num / Math.sqrt(dx * dy)) * 100) / 100;
}

export type Strength = "too_few" | "none" | "weak" | "moderate" | "strong";

export function strength(rho: number | null, n: number): Strength {
  if (n < MIN_HIRES || rho == null) return "too_few";
  const a = Math.abs(rho);
  return a < 0.1 ? "none" : a < 0.3 ? "weak" : a < 0.5 ? "moderate" : "strong";
}

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);

export interface Predictor {
  key: string;
  label: string;
  n: number;
  rho: number | null;
  strength: Strength;
  /** Average rating of hires in the top and bottom half of this signal. */
  topHalf: number | null;
  bottomHalf: number | null;
}

const PREDICTORS: { key: string; label: string; get: (s: HireSnapshot) => number | null }[] = [
  { key: "final", label: "Final interview score", get: (s) => s.finalScore },
  { key: "technical", label: "Technical round score", get: (s) => s.roundScores.technical ?? null },
  { key: "managerial", label: "Managerial round score", get: (s) => s.roundScores.managerial ?? null },
  { key: "hr", label: "HR round score", get: (s) => s.roundScores.hr ?? null },
  { key: "panel", label: "Panel hire votes", get: (s) => s.panelHireShare },
];

export function qualityStats(outcomes: HireOutcome[]) {
  const rated = outcomes.filter((o) => o.rating != null);
  const predictors: Predictor[] = PREDICTORS.map((p) => {
    const pairs = rated.map((o) => [p.get(o.snapshot), o.rating!] as const).filter((x): x is [number, number] => x[0] != null);
    const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
    const half = Math.floor(sorted.length / 2);
    const rho = spearman(pairs);
    return {
      key: p.key,
      label: p.label,
      n: pairs.length,
      rho,
      strength: strength(rho, pairs.length),
      topHalf: pairs.length >= 2 ? avg(sorted.slice(sorted.length - half).map((x) => x[1])) : null,
      bottomHalf: pairs.length >= 2 ? avg(sorted.slice(0, half).map((x) => x[1])) : null,
    };
  }).filter((p) => p.n > 0);

  const recs: Recommendation[] = ["strong_hire", "hire", "lean_no", "no_hire"];
  const byRecommendation = recs
    .map((r) => {
      const os = rated.filter((o) => o.snapshot.aiRecommendation === r);
      const rehire = os.filter((o) => o.wouldRehire);
      return { recommendation: r, n: os.length, avgRating: avg(os.map((o) => o.rating!)), rehire: rehire.length ? rehire.filter((o) => o.wouldRehire === "yes").length / rehire.length : null };
    })
    .filter((x) => x.n > 0);

  const joined = outcomes.filter((o) => o.joined);
  const withRehire = rated.filter((o) => o.wouldRehire);
  return {
    hires: outcomes.length,
    joined: joined.length,
    rated: rated.length,
    avgRating: avg(rated.map((o) => o.rating!)),
    rehireShare: withRehire.length ? withRehire.filter((o) => o.wouldRehire === "yes").length / withRehire.length : null,
    earlyAttrition: joined.length ? joined.filter((o) => o.leftEarly).length / joined.length : null,
    predictors,
    byRecommendation,
    tooEarly: rated.length < MIN_HIRES,
  };
}

export function strengthText(p: Predictor): string {
  if (p.strength === "too_few") return `Too early to tell (${p.n} rated hire${p.n === 1 ? "" : "s"}; ${MIN_HIRES} needed).`;
  const dir = (p.rho ?? 0) >= 0 ? "higher scores went with better ratings" : "higher scores went with worse ratings";
  return p.strength === "none" ? "No relationship with later ratings so far." : `${p.strength[0].toUpperCase()}${p.strength.slice(1)}: ${dir}.`;
}
