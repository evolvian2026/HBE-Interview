import type { Confidence, DriveConfig, ParamScore, Recommendation, RoundType } from "./types";

const REC_ORDER: Recommendation[] = ["no_hire", "lean_no", "hire", "strong_hire"];

export function recRank(r: Recommendation) {
  return REC_ORDER.indexOf(r);
}

export function minRec(a: Recommendation, b: Recommendation): Recommendation {
  return recRank(a) <= recRank(b) ? a : b;
}

export function band(score: number, bands: DriveConfig["bands"]): Recommendation {
  if (score >= bands.strongHire) return "strong_hire";
  if (score >= bands.hire) return "hire";
  if (score >= bands.leanNo) return "lean_no";
  return "no_hire";
}

/** Effective score of a parameter, taking a recruiter override into account. */
export function effectiveScore(p: ParamScore | undefined): number | null {
  if (!p) return null;
  if (p.override) return p.override.score;
  return p.score;
}

/**
 * Round score (0–100) = Σ(score/5 × weight) / Σ(weights of assessed params) × 100.
 * Parameters with weight 0 or not assessed (null) are excluded and their weight redistributed.
 */
export function roundScore(params: Record<string, ParamScore>, weights: Record<string, number>): number | null {
  let num = 0;
  let den = 0;
  for (const [id, w] of Object.entries(weights)) {
    if (!w) continue;
    const s = effectiveScore(params[id]);
    if (s == null) continue;
    num += (s / 5) * w;
    den += w;
  }
  if (!den) return null;
  return Math.round((num / den) * 1000) / 10;
}

export interface KnockoutResult {
  id: string;
  reason: string;
}

export function roundKnockouts(
  round: RoundType,
  params: Record<string, ParamScore>,
  config: DriveConfig,
  extra: { ethicsFailed?: boolean } = {},
): KnockoutResult[] {
  const out: KnockoutResult[] = [];
  if (round === "technical" && config.knockouts.authenticity) {
    const a = effectiveScore(params.authenticity);
    if (a != null && a <= 2)
      out.push({ id: "authenticity", reason: "Resume & Project Authenticity scored 2 or lower — recommendation capped at Lean No." });
  }
  if (round === "managerial" && config.knockouts.ethics) {
    const j = effectiveScore(params.judgement);
    if (extra.ethicsFailed || j === 1)
      out.push({ id: "ethics", reason: "Situational judgement on an ethics scenario was insufficient — recommendation capped at Lean No." });
  }
  return out;
}

export function roundRecommendation(score: number | null, knockouts: KnockoutResult[], config: DriveConfig): Recommendation {
  if (score == null) return "no_hire";
  let rec = band(score, config.bands);
  if (knockouts.length) rec = minRec(rec, "lean_no");
  return rec;
}

export function roundConfidence(input: {
  params: Record<string, ParamScore>;
  weights: Record<string, number>;
  completed: boolean;
  skips: number;
  disagreement: boolean;
}): Confidence {
  const weighted = Object.entries(input.weights).filter(([, w]) => w > 0);
  const assessed = weighted.filter(([id]) => effectiveScore(input.params[id]) != null);
  const coverage = weighted.length ? assessed.length / weighted.length : 0;
  const evidenceOk = assessed.every(([id]) => (input.params[id]?.evidence.length ?? 0) >= 2);
  let points = 0;
  if (coverage >= 0.99) points += 2;
  else if (coverage >= 0.6) points += 1;
  if (evidenceOk) points += 1;
  if (input.completed) points += 1;
  if (input.skips <= 1) points += 1;
  if (!input.disagreement) points += 1;
  if (points >= 5) return "high";
  if (points >= 3) return "medium";
  return "low";
}

/** Median of numbers (for multi-pass evaluation). Returns null if no values. */
export function median(values: (number | null | undefined)[]): number | null {
  const v = values.filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

/** True when any parameter differs by more than 1 point between two evaluation runs. */
export function runsDisagree(a: Record<string, number | null>, b: Record<string, number | null>): boolean {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k];
    const y = b[k];
    if (x == null || y == null) {
      if (x !== y) return true;
      continue;
    }
    if (Math.abs(x - y) > 1) return true;
  }
  return false;
}

/** Maximum Code Quality / Problem-Solving score attainable given hint usage (FEATURES §10.3). */
export function hintCap(maxHintLevelUsed: number): number {
  if (maxHintLevelUsed >= 3) return 4;
  if (maxHintLevelUsed === 2) return 4.5;
  return 5;
}

export interface RoundResult {
  type: RoundType;
  score: number | null;
  recommendation: Recommendation;
  knockouts: KnockoutResult[];
}

export interface FinalResult {
  finalScore: number | null;
  recommendation: Recommendation;
  partial: boolean;
  reasons: string[];
}

/** Combined score across rounds, renormalised over completed rounds (PRD §6.4). */
export function finalResult(config: DriveConfig, rounds: RoundResult[], expectedRounds: RoundType[]): FinalResult {
  const reasons: string[] = [];
  let num = 0;
  let den = 0;
  for (const r of rounds) {
    const w = config.roundWeights[r.type] ?? 0;
    if (r.score == null || !w) continue;
    num += r.score * w;
    den += w;
  }
  const finalScore = den ? Math.round((num / den) * 10) / 10 : null;
  let rec: Recommendation = finalScore == null ? "no_hire" : band(finalScore, config.bands);
  for (const r of rounds) {
    if (r.knockouts.length) {
      rec = minRec(rec, "lean_no");
      reasons.push(...r.knockouts.map((k) => k.reason));
    }
    if (config.knockouts.noHireCap && r.recommendation === "no_hire") {
      rec = minRec(rec, "lean_no");
      reasons.push(`The ${r.type} round was rated No Hire — final recommendation capped at Lean No.`);
    }
  }
  const done = new Set(rounds.filter((r) => r.score != null).map((r) => r.type));
  const partial = expectedRounds.some((t) => !done.has(t));
  if (partial) reasons.push("Not all configured rounds are complete — this is a partial result.");
  return { finalScore, recommendation: rec, partial, reasons };
}
