/**
 * Scoring test bench: freeze evaluated rounds (or write cases by hand) with the scores people agreed on, re-score
 * them through the live scoring pipeline — with the current evaluator model or one being tried — and compare.
 */
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { HttpError, type StaffUser } from "../auth/staff";
import { audit } from "../audit";
import { enqueue } from "../jobs/queue";
import { loadSessionContext } from "../interview/load";
import { buildBundle, scoreBundle, scoringExtras, type ScoringExtras } from "./evaluation";
import { scrubPii, type EvidenceBundle } from "../ai/evaluation";
import { isMock, modelFor, refreshModelOverrides } from "../ai/gateway";
import { MODEL_CHOICES } from "../settings-shared";
import { getSettings } from "../settings";
import { PARAMETERS } from "../core/rubrics";
import { enabledRounds } from "../core/rounds";
import { effectiveScore, roundScore } from "../core/scoring";
import { estimateCost } from "../core/metrics";
import { BENCH, compareRuns, expectedProblems, mapStrings, parseWrittenTranscript, runMetrics, type BenchResult, type Expected, type RunMetrics, type RunComparison } from "../core/benchmark";
import { ROUND_LABEL, type DriveConfig, type ParamScore, type Recommendation, type RoundType } from "../core/types";

const STAGE = "test_bench";
type CaseRow = typeof schema.benchmarkCases.$inferSelect;
type RunRow = typeof schema.benchmarkRuns.$inferSelect;

export interface RunSummary extends RunMetrics {
  comparedWith: { runId: string; label: string; baseline: boolean } | null;
  comparison: RunComparison | null;
  failed: number;
}

const actor = (u: StaffUser) => ({ type: "staff" as const, id: u.id, orgId: u.orgId });
const weightedIds = (type: RoundType, weights: Record<string, number>) => PARAMETERS[type].filter((p) => (weights[p.id] ?? 0) > 0).map((p) => p.id);
const shortId = (id: string) => id.slice(0, 6);

/* --------------------------------- Cases ---------------------------------- */

async function ownCase(orgId: string, id: string): Promise<CaseRow> {
  const [c] = await db.select().from(schema.benchmarkCases).where(and(eq(schema.benchmarkCases.id, id), eq(schema.benchmarkCases.orgId, orgId)));
  if (!c) throw new HttpError(404, "Test case not found");
  return c;
}

/** Remove the candidate's name, email and code-host username everywhere in a frozen case (images are left alone). */
function anonymise(bundle: EvidenceBundle, extras: ScoringExtras, tokens: string[], literals: string[]) {
  const lits = literals.filter((l) => l && l.length >= 3);
  const scrub = (s: string) => {
    let out = scrubPii(s, tokens);
    for (const l of lits) out = out.replace(new RegExp(l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[NAME]");
    return out;
  };
  const { images, ...rest } = bundle;
  return { bundle: { ...mapStrings(rest, scrub), images } as EvidenceBundle, extras: mapStrings(extras, scrub) };
}

/** Make a test case from an evaluated round. Expected scores start from a blind review if there is one. */
export async function caseFromReport(user: StaffUser, reportId: string) {
  const [row] = await db
    .select({ report: schema.roundReports, candidacy: schema.candidacies, drive: schema.drives })
    .from(schema.roundReports)
    .innerJoin(schema.candidacies, eq(schema.roundReports.candidacyId, schema.candidacies.id))
    .innerJoin(schema.drives, eq(schema.candidacies.driveId, schema.drives.id))
    .where(and(eq(schema.roundReports.id, reportId), eq(schema.candidacies.orgId, user.orgId)));
  if (!row) throw new HttpError(404, "Round not found");
  const { report } = row;
  if (report.status !== "ready" || !report.params) throw new HttpError(409, "Only evaluated rounds can be added.");
  const [dupe] = await db.select({ id: schema.benchmarkCases.id }).from(schema.benchmarkCases).where(and(eq(schema.benchmarkCases.orgId, user.orgId), eq(schema.benchmarkCases.sourceReportId, reportId)));
  if (dupe) throw new HttpError(409, "This round is already in the test bench.");
  const ctx = await loadSessionContext(report.sessionId);
  if (!ctx?.round) throw new HttpError(409, "The interview for this round is no longer available.");

  const { bundle: raw, extras: rawExtras } = await buildBundle(ctx, { orgId: user.orgId, stage: STAGE });
  const completed = ctx.session.endReason === "completed" || ctx.session.endReason === "time_up";
  const x = scoringExtras(rawExtras, { hasRepo: ctx.repos.some((r) => r.status === "ready"), completed, skips: ctx.state.skipsUsed });
  const { bundle, extras } = anonymise(raw, x, ctx.candidate.name.split(/\s+/).filter(Boolean), [ctx.candidate.email, ctx.candidate.githubUsername ?? ""]);

  const ai = report.params as Record<string, ParamScore>;
  const aiScores = Object.fromEntries(Object.entries(ai).map(([k, p]) => [k, p.score]));
  const [review] = await db.select().from(schema.calibrationReviews).where(eq(schema.calibrationReviews.reportId, reportId)).orderBy(desc(schema.calibrationReviews.createdAt)).limit(1);
  const overridden = Object.values(ai).some((p) => p.override);
  const expected: Expected = review
    ? { params: review.scores, recommendation: review.recommendation as Recommendation }
    : { params: Object.fromEntries(Object.entries(ai).map(([k, p]) => [k, effectiveScore(p)])), recommendation: report.recommendation as Recommendation };
  const expectedSource = review ? "calibration" : overridden ? "override" : "ai";
  const title = `${ROUND_LABEL[ctx.round.type]} · ${row.drive.title} · #${shortId(report.id)}`;
  const [c] = await db
    .insert(schema.benchmarkCases)
    .values({
      orgId: user.orgId,
      candidacyId: ctx.candidacy.id,
      sourceReportId: report.id,
      title,
      roundType: ctx.round.type,
      bundle,
      extras,
      config: ctx.config,
      expected,
      expectedSource,
      original: { params: aiScores, recommendation: report.recommendation ?? "no_hire", score: report.roundScore, evaluator: (report.versions as { evaluator?: string } | null)?.evaluator ?? "" },
      createdBy: user.id,
    })
    .onConflictDoNothing()
    .returning();
  if (!c) throw new HttpError(409, "This round is already in the test bench.");
  await audit(actor(user), "benchmark.case_add", "benchmark_case", c.id, { reportId, expectedSource });
  return c;
}

/** Add every round with a completed blind review that isn't in the bench yet (people's scores are the reference). */
export async function casesFromCalibration(user: StaffUser) {
  const rows = await db
    .selectDistinct({ reportId: schema.calibrationReviews.reportId })
    .from(schema.calibrationReviews)
    .innerJoin(schema.roundReports, eq(schema.calibrationReviews.reportId, schema.roundReports.id))
    .where(
      and(
        eq(schema.calibrationReviews.orgId, user.orgId),
        eq(schema.roundReports.status, "ready"),
        sql`not exists (select 1 from benchmark_cases b where b.org_id = ${user.orgId} and b.source_report_id = ${schema.calibrationReviews.reportId})`,
      ),
    )
    .limit(25);
  let added = 0;
  for (const r of rows) {
    const ok = await caseFromReport(user, r.reportId).then(() => true).catch(() => false);
    if (ok) added++;
  }
  return { added };
}

export interface WrittenCaseInput {
  title: string;
  driveId: string;
  roundType: RoundType;
  transcript: string;
  exercise?: string;
  expected: Expected;
  notes?: string;
}

/** A case written from scratch (no candidate data): kept regardless of retention. */
export async function writtenCase(user: StaffUser, input: WrittenCaseInput) {
  const [drive] = await db.select().from(schema.drives).where(and(eq(schema.drives.id, input.driveId), eq(schema.drives.orgId, user.orgId)));
  if (!drive) throw new HttpError(404, "Drive not found");
  const [version] = await db.select().from(schema.driveVersions).where(eq(schema.driveVersions.driveId, drive.id)).orderBy(desc(schema.driveVersions.version)).limit(1);
  const config = version.config as DriveConfig;
  const round = enabledRounds(config).find((r) => r.type === input.roundType);
  if (!round) throw new HttpError(400, `This drive has no ${ROUND_LABEL[input.roundType]}.`);
  const { messages, problems } = parseWrittenTranscript(input.transcript);
  const ids = weightedIds(round.type, round.weights);
  const expected = { params: Object.fromEntries(Object.entries(input.expected.params).filter(([k]) => ids.includes(k))), recommendation: input.expected.recommendation };
  problems.push(...expectedProblems(expected, ids));
  if (problems.length) throw new HttpError(400, problems.join(" "));

  const settings = await getSettings(user.orgId);
  const answers = messages.filter((m) => m.role === "candidate");
  // Mock mode scores from these "live" assessments (answer length); real models read the transcript.
  const microEvals = answers.map((m, i) => {
    const words = m.content.trim().split(/\s+/).length;
    return { parameter: ids[i % ids.length], score: words > 60 ? 4 : words > 15 ? 3 : 2, evidence: m.content.split(/\s+/).slice(0, 12).join(" "), ref: `M${m.seq}` };
  });
  const bundle: EvidenceBundle = {
    roundType: round.type,
    language: "English",
    roleProfileText: JSON.stringify({ ...config.roleProfile, title: config.title }, null, 1),
    weights: round.weights,
    sectionsText: `${round.sections.filter((s) => s.enabled).map((s) => `- ${s.title}`).join("\n")}\n(Written test case: the transcript may cover only some sections.)`,
    transcriptText: messages.map((m) => `[M${m.seq}] ${m.role === "ai" ? "Interviewer" : "Candidate"}: ${m.content}`).join("\n"),
    artifactsText: input.exercise?.trim() ? `### Written exercise\n${input.exercise.trim()}` : "",
    repoText: "",
    claimsText: "",
    priorSummaries: "",
    integrityText: "No integrity signals (written test case).",
    valuesText: round.type === "hr" ? settings.values.map((v) => `- ${v.name}: ${v.description}`).join("\n") : "",
    codingRules: round.type === "technical" ? "No hidden-test results are available; score code_quality from code shown or discussed, or null if none." : "",
    microEvals,
    candidateMessages: answers.map((m) => ({ ref: `M${m.seq}`, content: m.content })),
  };
  const extras: ScoringExtras = {
    candidateBySeq: answers.map((m) => [m.seq, m.content]),
    codeTexts: [],
    artifactTexts: input.exercise?.trim() ? [input.exercise.trim()] : [],
    maxHintLevel: 0,
    hasRepo: false,
    completed: true,
    skips: 0,
  };
  const [c] = await db
    .insert(schema.benchmarkCases)
    .values({ orgId: user.orgId, title: input.title.trim(), roundType: round.type, bundle, extras, config, expected, expectedSource: "manual", notes: input.notes?.trim() || null, createdBy: user.id })
    .returning();
  await audit(actor(user), "benchmark.case_write", "benchmark_case", c.id, { driveId: drive.id, roundType: round.type });
  return c;
}

export async function updateCase(user: StaffUser, id: string, patch: { title?: string; notes?: string | null; active?: boolean; expected?: Expected }) {
  const c = await ownCase(user.orgId, id);
  const set: Partial<typeof schema.benchmarkCases.$inferInsert> = { updatedAt: new Date() };
  if (patch.title !== undefined) set.title = patch.title.trim() || c.title;
  if (patch.notes !== undefined) set.notes = patch.notes?.trim() || null;
  if (patch.active !== undefined) set.active = patch.active;
  if (patch.expected) {
    const ids = weightedIds(c.roundType, (c.bundle as EvidenceBundle).weights);
    const expected = { params: Object.fromEntries(Object.entries(patch.expected.params).filter(([k]) => ids.includes(k))), recommendation: patch.expected.recommendation };
    const problems = expectedProblems(expected, ids);
    if (problems.length) throw new HttpError(400, problems.join(" "));
    set.expected = expected;
    set.expectedSource = "manual";
  }
  await db.update(schema.benchmarkCases).set(set).where(eq(schema.benchmarkCases.id, id));
  await audit(actor(user), "benchmark.case_update", "benchmark_case", id, Object.keys(patch));
}

export async function deleteCase(user: StaffUser, id: string) {
  await ownCase(user.orgId, id);
  await db.delete(schema.benchmarkCases).where(eq(schema.benchmarkCases.id, id));
  await audit(actor(user), "benchmark.case_delete", "benchmark_case", id);
}

export async function listCases(orgId: string) {
  const rows = await db
    .select({
      id: schema.benchmarkCases.id,
      title: schema.benchmarkCases.title,
      roundType: schema.benchmarkCases.roundType,
      expected: schema.benchmarkCases.expected,
      expectedSource: schema.benchmarkCases.expectedSource,
      active: schema.benchmarkCases.active,
      written: sql<boolean>`${schema.benchmarkCases.candidacyId} is null`,
      weights: sql<Record<string, number>>`${schema.benchmarkCases.bundle}->'weights'`,
      createdAt: schema.benchmarkCases.createdAt,
    })
    .from(schema.benchmarkCases)
    .where(eq(schema.benchmarkCases.orgId, orgId))
    .orderBy(desc(schema.benchmarkCases.createdAt));
  return rows.map((r) => ({ ...r, expectedScore: expectedRoundScore(r.expected, r.weights) }));
}

export function expectedRoundScore(expected: Expected | { params: Record<string, number | null> }, weights: Record<string, number>) {
  const params = Object.fromEntries(Object.entries(expected.params).map(([k, v]) => [k, { score: v, justification: "", evidence: [], confidence: "high" } as ParamScore]));
  return roundScore(params, weights);
}

export async function caseDetail(user: StaffUser, id: string) {
  const c = await ownCase(user.orgId, id);
  const history = await db
    .select({ result: schema.benchmarkResults, run: { id: schema.benchmarkRuns.id, label: schema.benchmarkRuns.label, model: schema.benchmarkRuns.model, createdAt: schema.benchmarkRuns.createdAt } })
    .from(schema.benchmarkResults)
    .innerJoin(schema.benchmarkRuns, eq(schema.benchmarkResults.runId, schema.benchmarkRuns.id))
    .where(and(eq(schema.benchmarkResults.caseId, id), eq(schema.benchmarkResults.status, "done")))
    .orderBy(desc(schema.benchmarkRuns.createdAt), asc(schema.benchmarkResults.repeat))
    .limit(30);
  const [candidacyLive] = c.candidacyId ? await db.select({ updatedAt: schema.candidacies.updatedAt }).from(schema.candidacies).where(eq(schema.candidacies.id, c.candidacyId)) : [];
  return { case: c, bundle: c.bundle as EvidenceBundle, history, linkedToCandidate: !!candidacyLive };
}

/* ---------------------------------- Runs ---------------------------------- */

async function ownRun(orgId: string, id: string): Promise<RunRow> {
  const [r] = await db.select().from(schema.benchmarkRuns).where(and(eq(schema.benchmarkRuns.id, id), eq(schema.benchmarkRuns.orgId, orgId)));
  if (!r) throw new HttpError(404, "Run not found");
  return r;
}

/** The evaluator model a run would use now. */
export async function currentEvaluatorModel() {
  if (isMock()) return "mock";
  await refreshModelOverrides();
  return modelFor("evaluator");
}

export async function startRun(orgId: string, by: StaffUser | null, input: { label?: string; model?: string; repeats?: number; trigger?: "manual" | "scheduled" }) {
  const [running] = await db.select({ id: schema.benchmarkRuns.id }).from(schema.benchmarkRuns).where(and(eq(schema.benchmarkRuns.orgId, orgId), eq(schema.benchmarkRuns.status, "running")));
  if (running) throw new HttpError(409, "A test run is already in progress — wait for it to finish or cancel it.");
  const cases = await db
    .select({ id: schema.benchmarkCases.id, title: schema.benchmarkCases.title, expected: schema.benchmarkCases.expected })
    .from(schema.benchmarkCases)
    .where(and(eq(schema.benchmarkCases.orgId, orgId), eq(schema.benchmarkCases.active, true)))
    .orderBy(asc(schema.benchmarkCases.createdAt))
    .limit(BENCH.maxCases);
  if (!cases.length) throw new HttpError(400, "Add at least one test case first.");
  const current = await currentEvaluatorModel();
  const override = !!input.model && input.model !== current;
  if (override && (isMock() || !MODEL_CHOICES.includes(input.model!))) throw new HttpError(400, "Choose one of the listed models.");
  const model = override ? input.model! : current;
  const repeats = Math.min(BENCH.maxRepeats, Math.max(1, Math.round(input.repeats ?? 1)));
  const trigger = input.trigger ?? "manual";
  const label = input.label?.trim().slice(0, 120) || `${trigger === "scheduled" ? "Monthly check" : override ? `Trying ${model}` : "Check"} · ${new Date().toISOString().slice(0, 10)}`;
  const [run] = await db.insert(schema.benchmarkRuns).values({ orgId, label, model, modelOverride: override, repeats, trigger, caseCount: cases.length, createdBy: by?.id ?? null }).returning();
  const rows = await db
    .insert(schema.benchmarkResults)
    .values(cases.flatMap((c) => Array.from({ length: repeats }, (_, i) => ({ runId: run.id, caseId: c.id, caseTitle: c.title, repeat: i + 1, expected: c.expected }))))
    .returning({ id: schema.benchmarkResults.id });
  for (const r of rows) await enqueue("benchmark-case", { resultId: r.id }, { singletonKey: `bench:${r.id}`, maxAttempts: 2 });
  await audit(by ? actor(by) : { type: "system", orgId }, "benchmark.run_start", "benchmark_run", run.id, { model, override, repeats, cases: cases.length, trigger });
  return run;
}

export async function benchmarkCaseJob(payload: { resultId: string }) {
  const [row] = await db
    .select({ result: schema.benchmarkResults, run: schema.benchmarkRuns })
    .from(schema.benchmarkResults)
    .innerJoin(schema.benchmarkRuns, eq(schema.benchmarkResults.runId, schema.benchmarkRuns.id))
    .where(eq(schema.benchmarkResults.id, payload.resultId));
  if (!row || row.result.status !== "queued") return;
  const { result, run } = row;
  if (run.status !== "running") {
    await db.update(schema.benchmarkResults).set({ status: "skipped", completedAt: new Date() }).where(eq(schema.benchmarkResults.id, result.id));
    return finishIfDone(run.id);
  }
  const [c] = result.caseId ? await db.select().from(schema.benchmarkCases).where(eq(schema.benchmarkCases.id, result.caseId)) : [];
  if (!c) {
    await db.update(schema.benchmarkResults).set({ status: "skipped", error: "The case was deleted during the run.", completedAt: new Date() }).where(eq(schema.benchmarkResults.id, result.id));
    return finishIfDone(run.id);
  }
  const bundle = c.bundle as EvidenceBundle;
  const out = await scoreBundle(bundle, c.extras as ScoringExtras, { type: c.roundType, weights: bundle.weights }, c.config as DriveConfig, {
    orgId: run.orgId,
    model: run.model === "mock" ? undefined : run.model,
    benchmarkRunId: run.id,
    stage: STAGE,
  });
  await db
    .update(schema.benchmarkResults)
    .set({
      status: "done",
      params: Object.fromEntries(Object.entries(out.params).map(([k, p]) => [k, p.score])),
      roundScore: out.score,
      recommendation: out.recommendation,
      confidence: out.confidence,
      disagreement: out.disagreement,
      completedAt: new Date(),
    })
    .where(eq(schema.benchmarkResults.id, result.id));
  await finishIfDone(run.id);
}

export async function benchmarkCaseFailed(payload: { resultId: string; error?: string }) {
  const [r] = await db
    .update(schema.benchmarkResults)
    .set({ status: "failed", error: (payload.error ?? "Scoring failed").split("\n")[0].slice(0, 500), completedAt: new Date() })
    .where(and(eq(schema.benchmarkResults.id, payload.resultId), eq(schema.benchmarkResults.status, "queued")))
    .returning({ runId: schema.benchmarkResults.runId });
  if (r) await finishIfDone(r.runId);
}

const toBench = (r: typeof schema.benchmarkResults.$inferSelect): BenchResult => ({
  caseId: r.caseId ?? `deleted:${r.id}`,
  caseTitle: r.caseTitle,
  repeat: r.repeat,
  expected: r.expected as Expected,
  params: r.params ?? {},
  roundScore: r.roundScore,
  recommendation: (r.recommendation ?? "no_hire") as Recommendation,
});

async function doneResults(runId: string) {
  return db.select().from(schema.benchmarkResults).where(and(eq(schema.benchmarkResults.runId, runId), eq(schema.benchmarkResults.status, "done")));
}

/** The run to compare with: the baseline, or else the previous completed run. */
async function comparisonRun(run: RunRow) {
  const [baseline] = await db
    .select()
    .from(schema.benchmarkRuns)
    .where(and(eq(schema.benchmarkRuns.orgId, run.orgId), eq(schema.benchmarkRuns.isBaseline, true), eq(schema.benchmarkRuns.status, "completed"), sql`${schema.benchmarkRuns.id} <> ${run.id}`));
  if (baseline) return { run: baseline, baseline: true };
  const [prev] = await db
    .select()
    .from(schema.benchmarkRuns)
    .where(and(eq(schema.benchmarkRuns.orgId, run.orgId), eq(schema.benchmarkRuns.status, "completed"), sql`${schema.benchmarkRuns.createdAt} < ${run.createdAt}`))
    .orderBy(desc(schema.benchmarkRuns.createdAt))
    .limit(1);
  return prev ? { run: prev, baseline: false } : null;
}

export async function summarise(run: RunRow): Promise<RunSummary> {
  const all = await db.select().from(schema.benchmarkResults).where(eq(schema.benchmarkResults.runId, run.id));
  const done = all.filter((r) => r.status === "done");
  const metrics = runMetrics(done.map(toBench));
  const other = await comparisonRun(run);
  const comparison = other ? compareRuns(done.map(toBench), (await doneResults(other.run.id)).map(toBench)) : null;
  return {
    ...metrics,
    failed: all.filter((r) => r.status === "failed").length,
    comparedWith: other ? { runId: other.run.id, label: other.run.label, baseline: other.baseline } : null,
    comparison: comparison?.cases ? comparison : null,
  };
}

/** When the last case of a run finishes, write the metrics (once, even if two jobs finish together). */
async function finishIfDone(runId: string) {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.benchmarkResults)
    .where(and(eq(schema.benchmarkResults.runId, runId), eq(schema.benchmarkResults.status, "queued")));
  if (n > 0) return;
  const [run] = await db.select().from(schema.benchmarkRuns).where(eq(schema.benchmarkRuns.id, runId));
  if (!run || run.status !== "running") return;
  const summary = await summarise(run);
  const status = summary.scored ? "completed" : "failed";
  const [won] = await db
    .update(schema.benchmarkRuns)
    .set({ status, summary, completedAt: new Date() })
    .where(and(eq(schema.benchmarkRuns.id, runId), eq(schema.benchmarkRuns.status, "running")))
    .returning({ id: schema.benchmarkRuns.id });
  if (!won) return;
  // The first completed run becomes the baseline automatically.
  if (status === "completed") {
    const [base] = await db.select({ id: schema.benchmarkRuns.id }).from(schema.benchmarkRuns).where(and(eq(schema.benchmarkRuns.orgId, run.orgId), eq(schema.benchmarkRuns.isBaseline, true)));
    if (!base) await db.update(schema.benchmarkRuns).set({ isBaseline: true }).where(eq(schema.benchmarkRuns.id, runId));
  }
  await audit({ type: "system", orgId: run.orgId }, "benchmark.run_complete", "benchmark_run", runId, { status, verdict: summary.verdict, mae: summary.overall.mae, sameSide: summary.recommendation.sameSide });
}

export async function cancelRun(user: StaffUser, id: string) {
  const run = await ownRun(user.orgId, id);
  if (run.status !== "running") throw new HttpError(409, "This run has already finished.");
  await db.update(schema.benchmarkResults).set({ status: "skipped", completedAt: new Date() }).where(and(eq(schema.benchmarkResults.runId, id), eq(schema.benchmarkResults.status, "queued")));
  const summary = await summarise(run);
  await db.update(schema.benchmarkRuns).set({ status: "cancelled", summary, completedAt: new Date() }).where(eq(schema.benchmarkRuns.id, id));
  await audit(actor(user), "benchmark.run_cancel", "benchmark_run", id);
}

export async function setBaseline(user: StaffUser, id: string) {
  const run = await ownRun(user.orgId, id);
  if (run.status !== "completed") throw new HttpError(409, "Only a completed run can be the baseline.");
  await db.transaction(async (tx) => {
    await tx.update(schema.benchmarkRuns).set({ isBaseline: false }).where(and(eq(schema.benchmarkRuns.orgId, user.orgId), eq(schema.benchmarkRuns.isBaseline, true)));
    await tx.update(schema.benchmarkRuns).set({ isBaseline: true }).where(eq(schema.benchmarkRuns.id, id));
  });
  await audit(actor(user), "benchmark.baseline", "benchmark_run", id, { model: run.model });
}

async function runCosts(runIds: string[]) {
  if (!runIds.length) return new Map<string, number>();
  const rows = await db
    .select({
      runId: schema.aiCalls.benchmarkRunId,
      model: schema.aiCalls.model,
      input: sql<number>`coalesce(sum(${schema.aiCalls.inputTokens}),0)::int`,
      output: sql<number>`coalesce(sum(${schema.aiCalls.outputTokens}),0)::int`,
      cacheRead: sql<number>`coalesce(sum(${schema.aiCalls.cacheReadTokens}),0)::int`,
      cacheWrite: sql<number>`coalesce(sum(${schema.aiCalls.cacheWriteTokens}),0)::int`,
    })
    .from(schema.aiCalls)
    .where(and(isNotNull(schema.aiCalls.benchmarkRunId), inArray(schema.aiCalls.benchmarkRunId, runIds)))
    .groupBy(schema.aiCalls.benchmarkRunId, schema.aiCalls.model);
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.runId!, (out.get(r.runId!) ?? 0) + estimateCost(r.model, { input: Number(r.input), output: Number(r.output), cacheRead: Number(r.cacheRead), cacheWrite: Number(r.cacheWrite) }));
  return out;
}

export async function listRuns(orgId: string, limit = 20) {
  const runs = await db.select().from(schema.benchmarkRuns).where(eq(schema.benchmarkRuns.orgId, orgId)).orderBy(desc(schema.benchmarkRuns.createdAt)).limit(limit);
  const progress = runs.some((r) => r.status === "running")
    ? await db
        .select({ runId: schema.benchmarkResults.runId, done: sql<number>`count(*) filter (where ${schema.benchmarkResults.status} <> 'queued')::int`, total: sql<number>`count(*)::int` })
        .from(schema.benchmarkResults)
        .where(inArray(schema.benchmarkResults.runId, runs.filter((r) => r.status === "running").map((r) => r.id)))
        .groupBy(schema.benchmarkResults.runId)
    : [];
  const costs = await runCosts(runs.map((r) => r.id));
  return runs.map((r) => ({ ...r, summary: r.summary as RunSummary | null, cost: costs.get(r.id) ?? 0, progress: progress.find((p) => p.runId === r.id) ?? null }));
}

export async function runDetail(user: StaffUser, id: string) {
  const run = await ownRun(user.orgId, id);
  const results = await db.select().from(schema.benchmarkResults).where(eq(schema.benchmarkResults.runId, id)).orderBy(asc(schema.benchmarkResults.caseTitle), asc(schema.benchmarkResults.repeat));
  const caseIds = [...new Set(results.map((r) => r.caseId).filter((x): x is string => !!x))];
  const cases = caseIds.length
    ? await db.select({ id: schema.benchmarkCases.id, roundType: schema.benchmarkCases.roundType, weights: sql<Record<string, number>>`${schema.benchmarkCases.bundle}->'weights'` }).from(schema.benchmarkCases).where(inArray(schema.benchmarkCases.id, caseIds))
    : [];
  // A finished run shows the summary written at the time; a running one is summarised live.
  const summary = run.status === "running" ? await summarise(run) : ((run.summary as RunSummary | null) ?? (await summarise(run)));
  const cost = (await runCosts([id])).get(id) ?? 0;
  return { run, results, cases, summary, cost };
}

export async function runCsv(user: StaffUser, id: string) {
  const { run, results } = await runDetail(user, id);
  const params = [...new Set(results.flatMap((r) => [...Object.keys(r.params ?? {}), ...Object.keys((r.expected as Expected).params)]))].sort();
  const head = ["case", "repeat", "status", "expected_recommendation", "ai_recommendation", "ai_round_score", ...params.flatMap((p) => [`expected_${p}`, `ai_${p}`])];
  const cell = (v: unknown) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = results.map((r) => {
    const e = r.expected as Expected;
    return [r.caseTitle, r.repeat, r.status, e.recommendation, r.recommendation, r.roundScore, ...params.flatMap((p) => [e.params[p], r.params?.[p]])].map(cell).join(",");
  });
  await audit(actor(user), "benchmark.export", "benchmark_run", id);
  return { csv: [head.join(","), ...lines].join("\n") + "\n", name: `hbe-test-bench-${run.createdAt.toISOString().slice(0, 10)}.csv` };
}

/** Monthly automatic runs for organisations that turned them on (called from maintenance). */
export async function scheduledRuns(now = new Date()) {
  const orgs = await db.select({ id: schema.organizations.id }).from(schema.organizations);
  for (const o of orgs) {
    if (!(await getSettings(o.id)).testBenchMonthly) continue;
    const [last] = await db.select({ createdAt: schema.benchmarkRuns.createdAt }).from(schema.benchmarkRuns).where(eq(schema.benchmarkRuns.orgId, o.id)).orderBy(desc(schema.benchmarkRuns.createdAt)).limit(1);
    if (last && now.getTime() - last.createdAt.getTime() < 30 * 86_400_000) continue;
    await startRun(o.id, null, { trigger: "scheduled" }).catch(() => undefined);
  }
}
