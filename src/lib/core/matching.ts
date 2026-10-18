/**
 * Matching people in the talent pool to a role (pure, no AI call): skill coverage against the role's must-have and
 * nice-to-have skills, with a light years-of-experience check. Explainable by construction — every point comes from a
 * named skill the person has or lacks.
 */
import type { Seniority } from "./types";

const ALIASES: Record<string, string> = {
  js: "javascript",
  ecmascript: "javascript",
  ts: "typescript",
  node: "nodejs",
  "node js": "nodejs",
  postgres: "postgresql",
  psql: "postgresql",
  k8s: "kubernetes",
  golang: "go",
  "amazon web services": "aws",
  gcp: "google cloud",
  "google cloud platform": "google cloud",
  "c sharp": "c#",
  csharp: "c#",
  cpp: "c++",
  "react js": "react",
  reactjs: "react",
  "vue js": "vue",
  vuejs: "vue",
  "next js": "nextjs",
  "ci cd": "ci/cd",
  cicd: "ci/cd",
  ml: "machine learning",
  "rest api": "rest",
  "restful apis": "rest",
  "rest apis": "rest",
  mongo: "mongodb",
  "apache kafka": "kafka",
  tf: "terraform",
};

/** Canonical form of a skill name: lower-case, punctuation-light, aliases folded ("Node.js" → "nodejs", "K8s" → "kubernetes"). */
export function normaliseSkill(s: string): string {
  const base = s
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/\.js\b/g, "js")
    .replace(/[^a-z0-9+#/ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return ALIASES[base] ?? base;
}

/** Whether a person's skill satisfies a required one (exact after normalising, or a whole-word containment such as "aws lambda" ⊇ "aws"). */
function covers(have: string, want: string) {
  if (have === want) return true;
  if (want.length < 2) return false;
  return ` ${have} `.includes(` ${want} `) || (have.length >= 4 && ` ${want} `.includes(` ${have} `));
}

const MIN_YEARS: Record<Seniority, number> = { intern: 0, junior: 0, mid: 2, senior: 5, lead: 7, manager: 6, director: 10 };

export interface MatchInput {
  skills: string[];
  /** Total years of experience, if known. */
  years: number | null;
}

export interface MatchRole {
  mustHaveSkills: string[];
  niceToHaveSkills: string[];
  seniority: Seniority;
}

export interface MatchResult {
  /** 0–100. */
  score: number;
  matchedMust: string[];
  missingMust: string[];
  matchedNice: string[];
  yearsOk: boolean | null;
}

/** Fit score: must-haves 70, nice-to-haves 20, experience 10 (neutral when unknown). */
export function matchRole(person: MatchInput, role: MatchRole): MatchResult {
  const have = [...new Set(person.skills.map(normaliseSkill).filter(Boolean))];
  const has = (want: string) => have.some((h) => covers(h, normaliseSkill(want)));
  const must = role.mustHaveSkills.filter((s) => s.trim());
  const nice = role.niceToHaveSkills.filter((s) => s.trim());
  const matchedMust = must.filter(has);
  const missingMust = must.filter((s) => !has(s));
  const matchedNice = nice.filter(has);
  const yearsOk = person.years == null ? null : person.years >= MIN_YEARS[role.seniority];
  const mustPart = must.length ? (70 * matchedMust.length) / must.length : 35;
  const nicePart = nice.length ? (20 * matchedNice.length) / nice.length : 10;
  const yearsPart = yearsOk == null ? 5 : yearsOk ? 10 : 0;
  return { score: Math.round(mustPart + nicePart + yearsPart), matchedMust, missingMust, matchedNice, yearsOk };
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** Parse resume dates like "2019", "Mar 2021", "03/2021", "2021-03" or "present". */
export function parseResumeDate(s: string, now = new Date()): Date | null {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  if (/present|current|now|till date|ongoing/.test(t)) return now;
  let m = t.match(/^(\d{4})[-/.](\d{1,2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, 1));
  m = t.match(/^(\d{1,2})[-/.](\d{4})/);
  if (m) return new Date(Date.UTC(+m[2], +m[1] - 1, 1));
  m = t.match(/([a-z]{3})[a-z]*\.?\s+(\d{4})/);
  if (m && m[1] in MONTHS) return new Date(Date.UTC(+m[2], MONTHS[m[1]], 1));
  m = t.match(/(\d{4})/);
  if (m) return new Date(Date.UTC(+m[1], 0, 1));
  return null;
}

/** Total years across experience entries, counting overlapping periods once. */
export function yearsOfExperience(entries: { start: string; end: string }[], now = new Date()): number | null {
  const spans = entries
    .map((e) => [parseResumeDate(e.start, now), parseResumeDate(e.end || "present", now)] as const)
    .filter((p): p is readonly [Date, Date] => !!p[0] && !!p[1] && p[1] >= p[0])
    .map(([a, b]) => [a.getTime(), b.getTime()] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  if (!spans.length) return null;
  let total = 0;
  let [cs, ce] = spans[0];
  for (const [s, e] of spans.slice(1)) {
    if (s <= ce) ce = Math.max(ce, e);
    else {
      total += ce - cs;
      [cs, ce] = [s, e];
    }
  }
  total += ce - cs;
  return Math.round((total / (365.25 * 86_400_000)) * 10) / 10;
}
