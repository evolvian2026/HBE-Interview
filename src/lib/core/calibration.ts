/**
 * Human calibration of AI scores (pure). A reviewer scores a sampled round blind; these functions compare the two
 * score sets and summarise agreement across many reviews.
 */
import { recRank } from "./scoring";
import type { Recommendation } from "./types";

/** A score gap this large on any parameter, or a different side of the hire line, counts as a disagreement. */
export const DISAGREE_GAP = 2;
/** Below this many reviews a statistic is shown but never alerts. */
export const MIN_REVIEWS_FOR_ALERT = 10;
export const ALERT_WITHIN_ONE = 0.8;
export const ALERT_BIAS = 0.5;

export interface CalibrationSettings {
  /** Share of evaluated rounds picked for a blind review, 0–100. */
  sampleRate: number;
  /** Low-confidence AI evaluations are always picked. */
  includeLowConfidence: boolean;
}

export const DEFAULT_CALIBRATION: CalibrationSettings = { sampleRate: 10, includeLowConfidence: true };

/** Stable 32-bit FNV-1a hash, so the same report is always in or out of the sample. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Why a newly evaluated round should get a blind review, or null. */
export function sampleReason(reportId: string, confidence: string | null, s: CalibrationSettings): "sample" | "low_confidence" | null {
  if (s.includeLowConfidence && confidence === "low") return "low_confidence";
  if (s.sampleRate <= 0) return null;
  return fnv1a(reportId) / 2 ** 32 < s.sampleRate / 100 ? "sample" : null;
}

export const isHireSide = (r: Recommendation) => recRank(r) >= recRank("hire");

export interface ReviewComparison {
  /** Parameters both sides scored. */
  params: { id: string; human: number; ai: number; gap: number }[];
  maxGap: number;
  recommendationFlip: boolean;
  disagrees: boolean;
}

export function compareReview(human: Record<string, number>, ai: Record<string, number | null | undefined>, humanRec: Recommendation, aiRec: Recommendation): ReviewComparison {
  const params = Object.entries(human)
    .filter(([id]) => typeof ai[id] === "number")
    .map(([id, h]) => ({ id, human: h, ai: ai[id] as number, gap: Math.abs(h - (ai[id] as number)) }));
  const maxGap = params.reduce((m, p) => Math.max(m, p.gap), 0);
  const recommendationFlip = isHireSide(humanRec) !== isHireSide(aiRec);
  return { params, maxGap, recommendationFlip, disagrees: maxGap >= DISAGREE_GAP || recommendationFlip };
}

/** Quadratic weighted Cohen's kappa for ordinal ratings 1..k. Null when undefined (no spread in the ratings). */
export function weightedKappa(pairs: [number, number][], k = 5): number | null {
  const n = pairs.length;
  if (!n) return null;
  const obs = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const rowM = new Array<number>(k).fill(0);
  const colM = new Array<number>(k).fill(0);
  for (const [a, b] of pairs) {
    const i = Math.min(k, Math.max(1, Math.round(a))) - 1;
    const j = Math.min(k, Math.max(1, Math.round(b))) - 1;
    obs[i][j]++;
    rowM[i]++;
    colM[j]++;
  }
  let o = 0;
  let e = 0;
  for (let i = 0; i < k; i++)
    for (let j = 0; j < k; j++) {
      const w = (i - j) ** 2 / (k - 1) ** 2;
      o += w * obs[i][j];
      e += (w * rowM[i] * colM[j]) / n;
    }
  if (e === 0) return o === 0 ? 1 : null;
  return 1 - o / e;
}

export interface AgreementStat {
  n: number;
  meanAi: number | null;
  meanHuman: number | null;
  /** Mean of (AI − human): positive = the AI scores more generously than people do. */
  bias: number | null;
  /** Mean absolute difference. */
  mae: number | null;
  exact: number | null;
  withinOne: number | null;
  kappa: number | null;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Agreement over (ai, human) score pairs. */
export function agreement(pairs: [ai: number, human: number][]): AgreementStat {
  const n = pairs.length;
  if (!n) return { n, meanAi: null, meanHuman: null, bias: null, mae: null, exact: null, withinOne: null, kappa: null };
  return {
    n,
    meanAi: mean(pairs.map((p) => p[0])),
    meanHuman: mean(pairs.map((p) => p[1])),
    bias: mean(pairs.map(([a, h]) => a - h)),
    mae: mean(pairs.map(([a, h]) => Math.abs(a - h))),
    exact: pairs.filter(([a, h]) => a === h).length / n,
    withinOne: pairs.filter(([a, h]) => Math.abs(a - h) <= 1).length / n,
    kappa: weightedKappa(pairs),
  };
}

export const RECS: Recommendation[] = ["strong_hire", "hire", "lean_no", "no_hire"];

/** Recommendation agreement: confusion matrix (rows = AI, columns = human) and same-side-of-the-hire-line rate. */
export function recommendationAgreement(pairs: [ai: Recommendation, human: Recommendation][]) {
  const matrix = RECS.map(() => RECS.map(() => 0));
  for (const [a, h] of pairs) {
    const i = RECS.indexOf(a);
    const j = RECS.indexOf(h);
    if (i >= 0 && j >= 0) matrix[i][j]++;
  }
  const n = pairs.length;
  return {
    n,
    matrix,
    exact: n ? pairs.filter(([a, h]) => a === h).length / n : null,
    sameSide: n ? pairs.filter(([a, h]) => isHireSide(a) === isHireSide(h)).length / n : null,
  };
}

/** Plain-language warnings for statistics with enough reviews behind them. */
export function agreementAlerts(label: string, s: AgreementStat): string[] {
  if (s.n < MIN_REVIEWS_FOR_ALERT) return [];
  const out: string[] = [];
  if (s.withinOne != null && s.withinOne < ALERT_WITHIN_ONE) out.push(`${label}: the AI is within one point of reviewers only ${Math.round(s.withinOne * 100)}% of the time (target ${ALERT_WITHIN_ONE * 100}%).`);
  if (s.bias != null && Math.abs(s.bias) >= ALERT_BIAS) out.push(`${label}: the AI scores ${s.bias > 0 ? "higher" : "lower"} than reviewers by ${Math.abs(s.bias).toFixed(1)} points on average.`);
  return out;
}

/* ------------------------------ Accommodations ----------------------------- */

export const EXTRA_TIME_OPTIONS = [0, 25, 50, 100] as const;

/** Pause allowance for a round: the standard one, or the extended one granted as an accommodation. */
export function pauseAllowance(extraBreaks: boolean, base: { maxPauses: number; maxPauseSec: number }) {
  return extraBreaks ? { maxPauses: base.maxPauses + 2, maxPauseSec: 10 * 60 } : { maxPauses: base.maxPauses, maxPauseSec: base.maxPauseSec };
}
