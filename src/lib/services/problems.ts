import { and, eq, isNotNull } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { db, schema } from "../db";
import { pickProblem, problemById, type CodingProblem } from "../content";
import { executeTests } from "../exec";
import type { Difficulty, Language } from "../core/types";

const pid = customAlphabet("abcdefghijkmnopqrstuvwxyz23456789", 10);

function rowToProblem(r: typeof schema.codingProblems.$inferSelect): CodingProblem {
  return { id: r.id, title: r.title, difficulty: r.difficulty, tags: r.tags, statement: r.statement, samples: r.samples, hidden: r.hidden };
}

/** Bank problem or a validated custom problem. */
export async function getProblem(id: string): Promise<CodingProblem | undefined> {
  const bank = problemById(id);
  if (bank) return bank;
  const [r] = await db.select().from(schema.codingProblems).where(eq(schema.codingProblems.id, id));
  return r ? rowToProblem(r) : undefined;
}

/** Prefer the drive's validated custom problems (A-8); fall back to the curated bank. */
export async function pickProblemForDrive(driveId: string, opts: { difficulty: Difficulty[]; domain: string; skills: string[]; exclude: string[] }): Promise<CodingProblem> {
  const custom = (await db.select().from(schema.codingProblems).where(and(eq(schema.codingProblems.driveId, driveId), isNotNull(schema.codingProblems.validatedAt)))).filter(
    (p) => !opts.exclude.includes(p.id),
  );
  const matching = custom.filter((p) => opts.difficulty.includes(p.difficulty));
  const pool = matching.length ? matching : custom;
  if (pool.length) return rowToProblem(pool[Math.floor(Math.random() * pool.length)]);
  return pickProblem(opts);
}

export interface CustomProblemInput {
  title: string;
  difficulty: Difficulty;
  statement: string;
  samples: { input: string; output: string }[];
  hidden: { input: string; output: string }[];
  referenceLanguage: Language;
  referenceCode: string;
}

/** Run the reference solution against every test; the problem is usable only if all pass. */
export async function validateProblem(input: CustomProblemInput) {
  const tests = [...input.samples, ...input.hidden];
  const r = await executeTests(input.referenceLanguage, input.referenceCode, tests, { revealIO: true });
  const failures = r.results
    .map((x, i) => ({ i, x }))
    .filter(({ x }) => x.verdict !== "AC")
    .map(({ i, x }) => ({ test: i < input.samples.length ? `sample ${i + 1}` : `hidden ${i - input.samples.length + 1}`, verdict: x.verdict, stdout: x.stdout.slice(0, 300), stderr: x.stderr.slice(0, 300) }));
  return { ok: !r.unavailable && !r.compileError && r.passed === r.total, passed: r.passed, total: r.total, compileError: r.compileError, unavailable: r.unavailable, failures };
}

export async function createCustomProblem(driveId: string, input: CustomProblemInput, userId: string) {
  const validation = await validateProblem(input);
  const [row] = await db
    .insert(schema.codingProblems)
    .values({ id: `custom-${pid()}`, driveId, ...input, tags: ["custom"], validation, validatedAt: validation.ok ? new Date() : null, createdBy: userId })
    .returning();
  return { problem: row, validation };
}
