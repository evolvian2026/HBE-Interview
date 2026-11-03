/**
 * Scoring test bench (pure): compares the evaluator's scores on a fixed set of rounds with the scores people agreed
 * on, checks that repeated scoring is consistent, compares one run with another and gives a plain verdict.
 */
import { agreement, compareReview, isHireSide, recommendationAgreement, type AgreementStat } from "./calibration";
import type { Recommendation } from "./types";

export interface Expected {
  params: Record<string, number | null>;
  recommendation: Recommendation;
}

export interface BenchResult {
  caseId: string;
  caseTitle: string;
  repeat: number;
  expected: Expected;
  params: Record<string, number | null>;
  roundScore: number | null;
  recommendation: Recommendation;
}

/** Thresholds for the verdict (documented in FEATURES §29). */
export const BENCH = {
  /** Mean absolute score difference (points on the 1–5 scale). */
  passMae: 0.6,
  failMae: 1.0,
  /** Share of cases on the same side of the hire line as people. */
  passSameSide: 0.85,
  failSameSide: 0.7,
  /** Average lean (AI − people) worth flagging. */
  bias: 0.5,
  /** Share of cases with a big miss (2+ points on a parameter, or the other side of the hire line) that fails a run. */
  failBigMissShare: 0.2,
  /** Repeated scoring: a case is unstable if its recommendation changes or its round score moves this much. */
  unstableScoreRange: 10,
  failUnstableShare: 0.2,
  /** Below this many cases the verdict is shown with a warning. */
  minCases: 5,
  maxRepeats: 3,
  maxCases: 100,
} as const;

export type Verdict = "pass" | "review" | "fail";

export interface CaseOutcome {
  caseId: string;
  caseTitle: string;
  maxGap: number;
  recommendationFlip: boolean;
  bigMiss: boolean;
  /** Repeats > 1: spread of the round score and whether the recommendation changed between repeats. */
  scoreRange: number | null;
  recommendationChanged: boolean;
  unstable: boolean;
}

export interface RunMetrics {
  cases: number;
  scored: number;
  overall: AgreementStat;
  byParameter: Record<string, AgreementStat>;
  recommendation: { exact: number | null; sameSide: number | null; matrix: number[][] };
  bigMisses: number;
  unstable: number;
  repeats: number;
  outcomes: CaseOutcome[];
  verdict: Verdict;
  reasons: string[];
  lowSample: boolean;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const numeric = (p: Record<string, number | null>) => Object.fromEntries(Object.entries(p).filter(([, v]) => typeof v === "number")) as Record<string, number>;

/** One result against what people expected. */
export function caseComparison(r: Pick<BenchResult, "expected" | "params" | "recommendation">) {
  return compareReview(numeric(r.expected.params), r.params, r.expected.recommendation, r.recommendation);
}

export function runMetrics(results: BenchResult[]): RunMetrics {
  const byCase = new Map<string, BenchResult[]>();
  for (const r of results) byCase.set(r.caseId, [...(byCase.get(r.caseId) ?? []), r]);
  const repeats = Math.max(1, ...results.map((r) => r.repeat));

  const pairs: [number, number][] = [];
  const perParam = new Map<string, [number, number][]>();
  const recPairs: [Recommendation, Recommendation][] = [];
  for (const r of results) {
    for (const p of caseComparison(r).params) {
      pairs.push([p.ai, p.human]);
      perParam.set(p.id, [...(perParam.get(p.id) ?? []), [p.ai, p.human]]);
    }
    recPairs.push([r.recommendation, r.expected.recommendation]);
  }

  const outcomes: CaseOutcome[] = [...byCase.values()].map((rs) => {
    const comps = rs.map(caseComparison);
    const maxGap = Math.max(0, ...comps.map((c) => c.maxGap));
    const recommendationFlip = comps.some((c) => c.recommendationFlip);
    const scores = rs.map((r) => r.roundScore).filter((x): x is number => x != null);
    const scoreRange = rs.length > 1 && scores.length > 1 ? Math.round((Math.max(...scores) - Math.min(...scores)) * 10) / 10 : null;
    const recommendationChanged = rs.length > 1 && new Set(rs.map((r) => r.recommendation)).size > 1;
    return {
      caseId: rs[0].caseId,
      caseTitle: rs[0].caseTitle,
      maxGap,
      recommendationFlip,
      bigMiss: maxGap >= 2 || recommendationFlip,
      scoreRange,
      recommendationChanged,
      unstable: recommendationChanged || (scoreRange ?? 0) >= BENCH.unstableScoreRange,
    };
  });

  const overall = agreement(pairs);
  const rec = recommendationAgreement(recPairs);
  const bigMisses = outcomes.filter((o) => o.bigMiss).length;
  const unstable = outcomes.filter((o) => o.unstable).length;
  const n = outcomes.length;

  const fail: string[] = [];
  const review: string[] = [];
  if (overall.mae != null) {
    const msg = `Scores differ from your team's by ${overall.mae.toFixed(2)} points on average`;
    if (overall.mae > BENCH.failMae) fail.push(`${msg} (limit ${BENCH.failMae}).`);
    else if (overall.mae > BENCH.passMae) review.push(`${msg} (target ${BENCH.passMae} or less).`);
  }
  if (rec.sameSide != null) {
    const msg = `The hire / no-hire call matches your team's in ${pct(rec.sameSide)} of results`;
    if (rec.sameSide < BENCH.failSameSide) fail.push(`${msg} (limit ${pct(BENCH.failSameSide)}).`);
    else if (rec.sameSide < BENCH.passSameSide) review.push(`${msg} (target ${pct(BENCH.passSameSide)}).`);
  }
  if (overall.bias != null && Math.abs(overall.bias) >= BENCH.bias)
    review.push(`The AI scores ${overall.bias > 0 ? "more generously" : "more strictly"} than your team, by ${Math.abs(overall.bias).toFixed(2)} points on average.`);
  if (n && bigMisses / n > BENCH.failBigMissShare) fail.push(`${bigMisses} of ${n} cases are big misses (2+ points apart, or the other side of the hire line).`);
  else if (bigMisses) review.push(`${bigMisses} of ${n} case${n === 1 ? " is a big miss" : "s are big misses"} — open ${bigMisses === 1 ? "it" : "them"} below.`);
  if (repeats > 1 && n) {
    if (unstable / n > BENCH.failUnstableShare) fail.push(`${unstable} of ${n} cases got a different result when scored again.`);
    else if (unstable) review.push(`${unstable} of ${n} case${n === 1 ? "" : "s"} got a different result when scored again.`);
  }
  const verdict: Verdict = fail.length ? "fail" : review.length ? "review" : "pass";
  const reasons = [...fail, ...review];
  if (verdict === "pass") reasons.push("Scores and hire calls are in line with your team's on every check.");

  return {
    cases: n,
    scored: results.length,
    overall,
    byParameter: Object.fromEntries([...perParam].map(([id, ps]) => [id, agreement(ps)])),
    recommendation: { exact: rec.exact, sameSide: rec.sameSide, matrix: rec.matrix },
    bigMisses,
    unstable,
    repeats,
    outcomes,
    verdict,
    reasons,
    lowSample: n < BENCH.minCases,
  };
}

export interface RunComparison {
  /** Cases scored in both runs. */
  cases: number;
  /** Mean change in round score (this run − other run): positive = more generous now. */
  meanShift: number | null;
  /** Cases whose recommendation moved across the hire line. */
  crossedHireLine: { caseId: string; caseTitle: string; from: Recommendation; to: Recommendation }[];
  /** Cases whose round score moved 10+ points. */
  bigMoves: { caseId: string; caseTitle: string; from: number; to: number }[];
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** How this run differs from another (usually the baseline), case by case (first repeat of each). */
export function compareRuns(current: BenchResult[], other: BenchResult[]): RunComparison {
  const first = (rs: BenchResult[]) => new Map(rs.filter((r) => r.repeat === 1).map((r) => [r.caseId, r]));
  const a = first(current);
  const b = first(other);
  const shared = [...a.keys()].filter((k) => b.has(k));
  const shifts: number[] = [];
  const crossedHireLine: RunComparison["crossedHireLine"] = [];
  const bigMoves: RunComparison["bigMoves"] = [];
  for (const id of shared) {
    const now = a.get(id)!;
    const then = b.get(id)!;
    if (now.roundScore != null && then.roundScore != null) {
      shifts.push(now.roundScore - then.roundScore);
      if (Math.abs(now.roundScore - then.roundScore) >= BENCH.unstableScoreRange) bigMoves.push({ caseId: id, caseTitle: now.caseTitle, from: then.roundScore, to: now.roundScore });
    }
    if (isHireSide(now.recommendation) !== isHireSide(then.recommendation)) crossedHireLine.push({ caseId: id, caseTitle: now.caseTitle, from: then.recommendation, to: now.recommendation });
  }
  const m = avg(shifts);
  return { cases: shared.length, meanShift: m == null ? null : Math.round(m * 10) / 10, crossedHireLine, bigMoves };
}

/* ------------------------------ Written cases ------------------------------ */

export interface WrittenMessage {
  seq: number;
  role: "ai" | "candidate";
  content: string;
}

/**
 * A transcript typed by a person: lines starting "Interviewer:" (or "AI:") and "Candidate:" (or "C:"); other lines
 * continue the previous message. Used for test cases written from scratch (no real candidate's data).
 */
export function parseWrittenTranscript(text: string): { messages: WrittenMessage[]; problems: string[] } {
  const messages: WrittenMessage[] = [];
  const problems: string[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(interviewer|ai|q|candidate|c|a)\s*:\s*(.*)$/i);
    if (m) {
      const role = /^(interviewer|ai|q)$/i.test(m[1]) ? "ai" : "candidate";
      messages.push({ seq: messages.length + 1, role, content: m[2] });
    } else if (messages.length) messages[messages.length - 1].content += `\n${line}`;
    else problems.push("Start each message with “Interviewer:” or “Candidate:”.");
  }
  const answers = messages.filter((m) => m.role === "candidate" && m.content.trim());
  if (answers.length < 2) problems.push("Write at least two candidate answers.");
  if (!messages.some((m) => m.role === "ai")) problems.push("Include the interviewer's questions.");
  return { messages, problems: [...new Set(problems)] };
}

/** Apply a function to every string inside a JSON-like value (used to anonymise a frozen case). */
export function mapStrings<T>(value: T, fn: (s: string) => string): T {
  if (typeof value === "string") return fn(value) as T;
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, fn)])) as T;
  return value;
}

/** Validate expected scores against the round's weighted parameters. */
export function expectedProblems(expected: { params: Record<string, number | null>; recommendation: string }, paramIds: string[]): string[] {
  const out: string[] = [];
  for (const [id, v] of Object.entries(expected.params)) {
    if (!paramIds.includes(id)) out.push(`Unknown parameter: ${id}`);
    else if (v != null && (!Number.isInteger(v) || v < 1 || v > 5)) out.push(`Scores are whole numbers from 1 to 5 (${id}).`);
  }
  if (!Object.values(expected.params).some((v) => typeof v === "number")) out.push("Give an expected score for at least one parameter.");
  if (!["strong_hire", "hire", "lean_no", "no_hire"].includes(expected.recommendation)) out.push("Choose the expected recommendation.");
  return out;
}
