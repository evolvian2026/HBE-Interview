/**
 * Adverse-impact checks over NON-protected process cohorts (input mode, language, source, drive version,
 * OCR). HBE Interview collects no demographic data, so this monitors whether the *process* treats
 * candidates differently depending on how they took the interview — not who they are.
 */

export interface CohortObservation {
  cohort: string;
  passed: boolean;
  score: number | null;
}

export interface CohortStat {
  cohort: string;
  n: number;
  passRate: number;
  meanScore: number | null;
  /** passRate ÷ highest passRate among sufficiently-sized cohorts (the "four-fifths" ratio). */
  impactRatio: number | null;
  flagged: boolean;
  /** Too few observations to compare reliably. */
  small: boolean;
}

export const FOUR_FIFTHS = 0.8;
export const MIN_COHORT = 5;

export function cohortStats(obs: CohortObservation[], minN = MIN_COHORT): CohortStat[] {
  const groups = new Map<string, CohortObservation[]>();
  for (const o of obs) groups.set(o.cohort, [...(groups.get(o.cohort) ?? []), o]);
  const base = [...groups.entries()].map(([cohort, rows]) => {
    const scores = rows.map((r) => r.score).filter((s): s is number => s != null);
    return {
      cohort,
      n: rows.length,
      passRate: rows.filter((r) => r.passed).length / rows.length,
      meanScore: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
      small: rows.length < minN,
    };
  });
  const comparable = base.filter((b) => !b.small);
  const best = Math.max(0, ...comparable.map((b) => b.passRate));
  return base
    .map((b) => {
      const impactRatio = b.small || comparable.length < 2 || best === 0 ? null : b.passRate / best;
      return { ...b, impactRatio, flagged: impactRatio != null && impactRatio < FOUR_FIFTHS };
    })
    .sort((a, b) => b.n - a.n || a.cohort.localeCompare(b.cohort));
}

/** Mean of 1–5 survey ratings, ignoring blanks. */
export function meanRating(values: (number | null | undefined)[]): number | null {
  const v = values.filter((x): x is number => typeof x === "number");
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
