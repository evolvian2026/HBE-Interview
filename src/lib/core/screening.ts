/**
 * Screening tests (pure): pick and shuffle questions for a candidate, score an attempt, validate and import questions.
 * The correct answers never leave the server; the candidate sees options in a per-candidate order.
 */
import type { AptitudeQuestion, AptitudeSection } from "../content/aptitude";

export const SECTIONS: AptitudeSection[] = ["quant", "logical", "verbal", "technical"];

export interface ScreeningConfig {
  enabled: boolean;
  /** Questions per section (0 = section not used). */
  sections: Record<AptitudeSection, number>;
  durationMin: number;
  /** Pass mark, % of questions answered correctly. */
  passMark: number;
  /** Below the pass mark: reject straight away, or hold for a recruiter to decide. */
  onFail: "reject" | "review";
  /** Show the candidate their score after submitting. */
  showScore: boolean;
}

export const DEFAULT_SCREENING: ScreeningConfig = {
  enabled: false,
  sections: { quant: 5, logical: 5, verbal: 5, technical: 5 },
  durationMin: 25,
  passMark: 60,
  onFail: "review",
  showScore: false,
};

export const MAX_PER_SECTION = 30;

/** A question as stored on an attempt: options in the candidate's order and the correct index in that order. */
export interface AttemptQuestion {
  qid: string;
  section: AptitudeSection;
  stem: string;
  options: string[];
  correct: number;
}

/** Deterministic pseudo-random generator (mulberry32) so a candidate's paper can be reproduced from its seed. */
function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(xs: T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** The candidate's paper: N random questions per section (fewer if the bank is short), options shuffled. */
export function buildPaper(bank: AptitudeQuestion[], cfg: Pick<ScreeningConfig, "sections">, seed: string): AttemptQuestion[] {
  const rand = rng(seed);
  const out: AttemptQuestion[] = [];
  for (const section of SECTIONS) {
    const n = cfg.sections[section] ?? 0;
    if (n <= 0) continue;
    for (const q of shuffle(bank.filter((x) => x.section === section), rand).slice(0, n)) {
      const order = shuffle([0, 1, 2, 3].slice(0, q.options.length), rand);
      out.push({ qid: q.id, section, stem: q.stem, options: order.map((i) => q.options[i]), correct: order.indexOf(q.answer) });
    }
  }
  return out;
}

export interface ScreeningScore {
  correct: number;
  total: number;
  percent: number;
  answered: number;
  bySection: Partial<Record<AptitudeSection, { correct: number; total: number }>>;
}

export function scorePaper(paper: AttemptQuestion[], answers: Record<string, number>): ScreeningScore {
  const bySection: ScreeningScore["bySection"] = {};
  let correct = 0;
  let answered = 0;
  for (const q of paper) {
    const s = (bySection[q.section] ??= { correct: 0, total: 0 });
    s.total++;
    const a = answers[q.qid];
    if (typeof a === "number") answered++;
    if (a === q.correct) {
      correct++;
      s.correct++;
    }
  }
  const total = paper.length;
  return { correct, total, answered, percent: total ? Math.round((correct / total) * 1000) / 10 : 0, bySection };
}

export function configProblems(c: ScreeningConfig, bankCounts: Partial<Record<AptitudeSection, number>>): string[] {
  const out: string[] = [];
  const total = SECTIONS.reduce((n, s) => n + (c.sections[s] ?? 0), 0);
  if (c.enabled && total === 0) out.push("Choose at least one question for the screening test.");
  for (const s of SECTIONS) {
    const n = c.sections[s] ?? 0;
    if (n < 0 || n > MAX_PER_SECTION) out.push(`Questions per section must be 0–${MAX_PER_SECTION}.`);
    if (c.enabled && n > (bankCounts[s] ?? 0)) out.push(`Only ${bankCounts[s] ?? 0} ${s} questions are available — lower the number or add questions.`);
  }
  if (c.durationMin < 5 || c.durationMin > 180) out.push("The test must last 5–180 minutes.");
  if (c.passMark < 0 || c.passMark > 100) out.push("The pass mark is a percentage (0–100).");
  return [...new Set(out)];
}

export interface QuestionInput {
  section: string;
  difficulty?: string;
  stem: string;
  options: string[];
  answer: number;
  explanation?: string;
}

export function questionProblems(q: QuestionInput): string[] {
  const out: string[] = [];
  if (!SECTIONS.includes(q.section as AptitudeSection)) out.push(`Section must be one of: ${SECTIONS.join(", ")}.`);
  if (!q.stem?.trim() || q.stem.trim().length < 5) out.push("Write the question.");
  const opts = (q.options ?? []).map((o) => o?.trim()).filter(Boolean);
  if (opts.length !== 4) out.push("Give exactly four options.");
  if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) out.push("Options must be different.");
  if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) out.push("Mark which option is correct (A–D).");
  if (q.difficulty && !["easy", "medium", "hard"].includes(q.difficulty)) out.push("Difficulty is easy, medium or hard.");
  return out;
}

/**
 * Rows from a CSV with a header: section, difficulty (optional), question, a, b, c, d, answer (A–D or 1–4),
 * explanation (optional). Returns valid questions and per-row problems.
 */
export function csvRowsToQuestions(rows: string[][]): { questions: QuestionInput[]; problems: string[] } {
  if (!rows.length) return { questions: [], problems: ["The file is empty."] };
  const h = rows[0].map((x) => x.trim().toLowerCase());
  const col = (...names: string[]) => h.findIndex((x) => names.includes(x));
  const ix = { section: col("section"), difficulty: col("difficulty"), stem: col("question", "stem"), a: col("a", "option a"), b: col("b", "option b"), c: col("c", "option c"), d: col("d", "option d"), answer: col("answer", "correct"), explanation: col("explanation") };
  if ([ix.section, ix.stem, ix.a, ix.b, ix.c, ix.d, ix.answer].some((i) => i < 0)) return { questions: [], problems: ["The header must include: section, question, a, b, c, d, answer (difficulty and explanation are optional)."] };
  const questions: QuestionInput[] = [];
  const problems: string[] = [];
  rows.slice(1).forEach((r, i) => {
    const raw = (r[ix.answer] ?? "").trim().toUpperCase();
    const answer = /^[A-D]$/.test(raw) ? raw.charCodeAt(0) - 65 : /^[1-4]$/.test(raw) ? Number(raw) - 1 : -1;
    const q: QuestionInput = {
      section: (r[ix.section] ?? "").trim().toLowerCase(),
      difficulty: ix.difficulty >= 0 ? (r[ix.difficulty] ?? "").trim().toLowerCase() || undefined : undefined,
      stem: (r[ix.stem] ?? "").trim(),
      options: [r[ix.a], r[ix.b], r[ix.c], r[ix.d]].map((o) => (o ?? "").trim()),
      answer,
      explanation: ix.explanation >= 0 ? (r[ix.explanation] ?? "").trim() || undefined : undefined,
    };
    const p = questionProblems(q);
    if (p.length) problems.push(`Row ${i + 2}: ${p.join(" ")}`);
    else questions.push(q);
  });
  return { questions, problems };
}

/** Score distribution in 10-point bands (0–9 … 90–100). */
export function bands(percents: number[]): number[] {
  const out = new Array<number>(10).fill(0);
  for (const p of percents) out[Math.min(9, Math.floor(p / 10))]++;
  return out;
}
