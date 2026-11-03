/**
 * Screening tests: a timed multiple-choice test (quantitative, logical, verbal, technical) that a drive can require
 * after consent and before the resume and AI interview. Scored automatically, no AI involved. Below the pass mark the
 * candidate is either rejected or held for a recruiter, as the drive says.
 */
import { and, asc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { HttpError, canSeeDrive, hasRole, type StaffUser } from "../auth/staff";
import { audit } from "../audit";
import { APTITUDE_BANK, type AptitudeQuestion, type AptitudeSection } from "../content/aptitude";
import { DEFAULT_SCREENING, SECTIONS, bands, buildPaper, csvRowsToQuestions, questionProblems, scorePaper, type AttemptQuestion, type QuestionInput, type ScreeningConfig, type ScreeningScore } from "../core/screening";
import type { DriveConfig } from "../core/types";
import { parseCsv } from "../csv";

type Candidacy = typeof schema.candidacies.$inferSelect;
type Attempt = typeof schema.screeningAttempts.$inferSelect;

export function screeningOf(config: DriveConfig): ScreeningConfig {
  return { ...DEFAULT_SCREENING, ...(config.screening ?? {}), sections: { ...DEFAULT_SCREENING.sections, ...(config.screening?.sections ?? {}) } };
}

async function configFor(c: Candidacy) {
  const [v] = await db.select({ config: schema.driveVersions.config }).from(schema.driveVersions).where(eq(schema.driveVersions.id, c.driveVersionId));
  return screeningOf(v.config as DriveConfig);
}

/* --------------------------------- Bank --------------------------------- */

/** Built-in questions plus the organisation's own active ones. */
export async function bankFor(orgId: string): Promise<AptitudeQuestion[]> {
  const own = await db.select().from(schema.aptitudeQuestions).where(and(eq(schema.aptitudeQuestions.orgId, orgId), eq(schema.aptitudeQuestions.active, true)));
  return [
    ...APTITUDE_BANK,
    ...own.map((q) => ({ id: q.id, section: q.section, difficulty: q.difficulty, stem: q.stem, options: q.options as AptitudeQuestion["options"], answer: q.answer as AptitudeQuestion["answer"], explanation: q.explanation ?? "" })),
  ];
}

export async function bankCounts(orgId: string) {
  const bank = await bankFor(orgId);
  return Object.fromEntries(SECTIONS.map((s) => [s, bank.filter((q) => q.section === s).length])) as Record<AptitudeSection, number>;
}

export async function addQuestion(user: StaffUser, q: QuestionInput) {
  const p = questionProblems(q);
  if (p.length) throw new HttpError(400, p.join(" "));
  const [row] = await db
    .insert(schema.aptitudeQuestions)
    .values({ orgId: user.orgId, section: q.section as AptitudeSection, difficulty: (q.difficulty as "easy" | "medium" | "hard") ?? "medium", stem: q.stem.trim(), options: q.options.map((o) => o.trim()), answer: q.answer, explanation: q.explanation?.trim() || null, createdBy: user.id })
    .returning();
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "screening.question_add", "aptitude_question", row.id, { section: q.section });
  return row;
}

export async function importQuestions(user: StaffUser, csv: string) {
  const { questions, problems } = csvRowsToQuestions(parseCsv(csv));
  if (questions.length > 500) throw new HttpError(400, "Import up to 500 questions at a time.");
  for (const q of questions) await addQuestion(user, q);
  return { added: questions.length, problems };
}

export async function setQuestionActive(user: StaffUser, id: string, active: boolean) {
  const [r] = await db.update(schema.aptitudeQuestions).set({ active }).where(and(eq(schema.aptitudeQuestions.id, id), eq(schema.aptitudeQuestions.orgId, user.orgId))).returning({ id: schema.aptitudeQuestions.id });
  if (!r) throw new HttpError(404, "Question not found");
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, active ? "screening.question_on" : "screening.question_off", "aptitude_question", id);
}

export async function listOwnQuestions(orgId: string) {
  return db.select().from(schema.aptitudeQuestions).where(eq(schema.aptitudeQuestions.orgId, orgId)).orderBy(asc(schema.aptitudeQuestions.section), asc(schema.aptitudeQuestions.createdAt));
}

/* ------------------------------- Candidates ------------------------------- */

export async function attemptFor(candidacyId: string) {
  const [a] = await db.select().from(schema.screeningAttempts).where(eq(schema.screeningAttempts.candidacyId, candidacyId));
  return a ?? null;
}

/** Where the candidate stands: no test, to take, in progress, passed, waiting for review, or not passed. */
export async function screeningState(c: Candidacy) {
  const cfg = await configFor(c);
  if (!cfg.enabled) return { required: false as const, cfg };
  const a = await attemptFor(c.id);
  const status: "todo" | "in_progress" | "passed" | "review" | "failed" = !a ? "todo" : !a.submittedAt ? "in_progress" : a.passed ? "passed" : a.reviewStatus === "pending" ? "review" : "failed";
  return { required: true as const, cfg, attempt: a, status };
}

/** Onboarding (resume, projects) only starts once a required test is passed. */
export async function requireScreeningPassed(c: Candidacy) {
  const s = await screeningState(c);
  if (s.required && s.status !== "passed") throw new HttpError(409, "Please complete the screening test first.");
}

/** What the candidate sees: the questions in their order, never the answers. */
export function publicPaper(a: Attempt) {
  const paper = a.paper as AttemptQuestion[];
  return {
    questions: paper.map((q) => ({ qid: q.qid, section: q.section, stem: q.stem, options: q.options })),
    answers: (a.answers ?? {}) as Record<string, number>,
    deadlineAt: a.deadlineAt.toISOString(),
    submitted: !!a.submittedAt,
  };
}

export async function startAttempt(c: Candidacy) {
  if (c.stage !== "onboarding") throw new HttpError(409, "The test isn't available at this stage.");
  const cfg = await configFor(c);
  if (!cfg.enabled) throw new HttpError(404, "This role has no screening test.");
  const existing = await attemptFor(c.id);
  if (existing) return existing;
  const paper = buildPaper(await bankFor(c.orgId), cfg, c.id);
  if (!paper.length) throw new HttpError(503, "The test isn't ready — please contact the recruiter.");
  const now = new Date();
  const [a] = await db
    .insert(schema.screeningAttempts)
    .values({ candidacyId: c.id, orgId: c.orgId, driveId: c.driveId, paper, answers: {}, startedAt: now, deadlineAt: new Date(now.getTime() + cfg.durationMin * 60_000) })
    .onConflictDoNothing()
    .returning();
  if (!a) return (await attemptFor(c.id))!;
  await audit({ type: "candidate", id: c.id, orgId: c.orgId }, "screening.start", "candidacy", c.id, { questions: paper.length, durationMin: cfg.durationMin });
  return a;
}

/** Save one answer (allowed until the deadline; a short grace covers network delay). */
export async function saveAnswer(c: Candidacy, qid: string, choice: number | null) {
  const a = await attemptFor(c.id);
  if (!a) throw new HttpError(409, "Start the test first.");
  if (a.submittedAt) throw new HttpError(409, "The test has been submitted.");
  if (Date.now() > a.deadlineAt.getTime() + 15_000) {
    await submitAttempt(c, "time_up");
    throw new HttpError(409, "Time is up — your answers so far have been submitted.");
  }
  const paper = a.paper as AttemptQuestion[];
  const q = paper.find((x) => x.qid === qid);
  if (!q) throw new HttpError(400, "Unknown question.");
  if (choice != null && (!Number.isInteger(choice) || choice < 0 || choice >= q.options.length)) throw new HttpError(400, "Choose one of the options.");
  const answers = { ...((a.answers ?? {}) as Record<string, number>) };
  if (choice == null) delete answers[qid];
  else answers[qid] = choice;
  await db.update(schema.screeningAttempts).set({ answers }).where(and(eq(schema.screeningAttempts.id, a.id), isNull(schema.screeningAttempts.submittedAt)));
  return { saved: Object.keys(answers).length };
}

export async function recordFocusLoss(c: Candidacy, count: number) {
  const a = await attemptFor(c.id);
  if (!a || a.submittedAt) return;
  await db.update(schema.screeningAttempts).set({ focusLosses: sql`${schema.screeningAttempts.focusLosses} + ${Math.min(20, Math.max(0, count))}` }).where(eq(schema.screeningAttempts.id, a.id));
}

/** Score and close the attempt, then apply the drive's rule for a fail. */
export async function submitAttempt(c: Candidacy, reason: "submitted" | "time_up") {
  const a = await attemptFor(c.id);
  if (!a) throw new HttpError(409, "Start the test first.");
  if (a.submittedAt) return a;
  const cfg = await configFor(c);
  const score = scorePaper(a.paper as AttemptQuestion[], (a.answers ?? {}) as Record<string, number>);
  const passed = score.percent >= cfg.passMark;
  const [done] = await db
    .update(schema.screeningAttempts)
    .set({ submittedAt: new Date(), submitReason: reason, score, percent: score.percent, passed, reviewStatus: passed ? null : cfg.onFail === "review" ? "pending" : null })
    .where(and(eq(schema.screeningAttempts.id, a.id), isNull(schema.screeningAttempts.submittedAt)))
    .returning();
  if (!done) return (await attemptFor(c.id))!;
  await audit({ type: "candidate", id: c.id, orgId: c.orgId }, "screening.submit", "candidacy", c.id, { percent: score.percent, passed, reason });
  if (!passed && cfg.onFail === "reject") await rejectAfterTest(c.id, "automatic");
  return done;
}

async function rejectAfterTest(candidacyId: string, by: string) {
  await db.update(schema.candidacies).set({ stage: "rejected", finalStatus: "rejected", updatedAt: new Date() }).where(eq(schema.candidacies.id, candidacyId));
  const { sendCandidateEmail } = await import("./emails");
  await sendCandidateEmail(candidacyId, "reject").catch((e) => console.error("screening reject email failed", e));
  void by;
}

/** A recruiter decides on a test held for review: let the candidate continue, or not. */
export async function reviewAttempt(user: StaffUser, candidacyId: string, decision: "pass" | "fail", note?: string) {
  const [row] = await db.select({ c: schema.candidacies, d: schema.drives }).from(schema.candidacies).innerJoin(schema.drives, eq(schema.candidacies.driveId, schema.drives.id)).where(and(eq(schema.candidacies.id, candidacyId), eq(schema.candidacies.orgId, user.orgId)));
  if (!row || !canSeeDrive(user, row.d)) throw new HttpError(404, "Candidate not found");
  const a = await attemptFor(candidacyId);
  if (!a || a.reviewStatus !== "pending") throw new HttpError(409, "There's no test waiting for a decision.");
  await db.update(schema.screeningAttempts).set({ reviewStatus: decision === "pass" ? "passed" : "failed", passed: decision === "pass", reviewedBy: user.id, reviewedAt: new Date(), reviewNote: note?.trim() || null }).where(eq(schema.screeningAttempts.id, a.id));
  if (decision === "fail") await rejectAfterTest(candidacyId, user.id);
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, `screening.review_${decision}`, "candidacy", candidacyId, { percent: a.percent });
}

/** Maintenance: close attempts whose time has run out. */
export async function closeOverdueAttempts(now = new Date()) {
  const overdue = await db
    .select({ c: schema.candidacies })
    .from(schema.screeningAttempts)
    .innerJoin(schema.candidacies, eq(schema.screeningAttempts.candidacyId, schema.candidacies.id))
    .where(and(isNull(schema.screeningAttempts.submittedAt), lt(schema.screeningAttempts.deadlineAt, new Date(now.getTime() - 60_000))))
    .limit(200);
  for (const o of overdue) await submitAttempt(o.c, "time_up").catch((e) => console.error("screening auto-submit failed", e));
  return overdue.length;
}

/* --------------------------------- Staff --------------------------------- */

export async function pendingReviews(user: StaffUser) {
  if (!hasRole(user, "recruiter")) return [];
  const rows = await db
    .select({ c: schema.candidacies, name: schema.candidates.name, d: schema.drives, percent: schema.screeningAttempts.percent })
    .from(schema.screeningAttempts)
    .innerJoin(schema.candidacies, eq(schema.screeningAttempts.candidacyId, schema.candidacies.id))
    .innerJoin(schema.candidates, eq(schema.candidacies.candidateId, schema.candidates.id))
    .innerJoin(schema.drives, eq(schema.candidacies.driveId, schema.drives.id))
    .where(and(eq(schema.screeningAttempts.orgId, user.orgId), eq(schema.screeningAttempts.reviewStatus, "pending")));
  return rows.filter((r) => canSeeDrive(user, r.d));
}

/** Results for a drive: distribution, pass rate, sections, and by college (campus drives). */
export async function driveScreening(user: StaffUser, driveId: string) {
  const [d] = await db.select().from(schema.drives).where(and(eq(schema.drives.id, driveId), eq(schema.drives.orgId, user.orgId)));
  if (!d || !canSeeDrive(user, d)) throw new HttpError(404, "Drive not found");
  const rows = await db
    .select({ a: schema.screeningAttempts, name: schema.candidates.name, email: schema.candidates.email, college: schema.candidacies.college, candidacyId: schema.candidacies.id })
    .from(schema.screeningAttempts)
    .innerJoin(schema.candidacies, eq(schema.screeningAttempts.candidacyId, schema.candidacies.id))
    .innerJoin(schema.candidates, eq(schema.candidacies.candidateId, schema.candidates.id))
    .where(eq(schema.screeningAttempts.driveId, driveId));
  const done = rows.filter((r) => r.a.submittedAt);
  const pct = done.map((r) => r.a.percent ?? 0);
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
  const sectionAvg = Object.fromEntries(
    SECTIONS.map((s) => {
      const vals = done.map((r) => (r.a.score as ScreeningScore | null)?.bySection[s]).filter((x): x is { correct: number; total: number } => !!x && x.total > 0).map((x) => (x.correct / x.total) * 100);
      return [s, avg(vals)];
    }),
  ) as Record<AptitudeSection, number | null>;
  const colleges = new Map<string, typeof done>();
  for (const r of done) {
    const k = r.college?.trim() || "—";
    colleges.set(k, [...(colleges.get(k) ?? []), r]);
  }
  const byCollege = [...colleges]
    .map(([college, rs]) => ({ college, n: rs.length, avg: avg(rs.map((r) => r.a.percent ?? 0)), passRate: rs.filter((r) => r.a.passed).length / rs.length, top: Math.max(...rs.map((r) => r.a.percent ?? 0)) }))
    .sort((a, b) => b.n - a.n);
  return {
    drive: d,
    started: rows.length,
    submitted: done.length,
    inProgress: rows.length - done.length,
    passed: done.filter((r) => r.a.passed).length,
    pending: done.filter((r) => r.a.reviewStatus === "pending").length,
    avg: avg(pct),
    bands: bands(pct),
    sectionAvg,
    byCollege,
    results: done
      .sort((a, b) => (b.a.percent ?? 0) - (a.a.percent ?? 0))
      .map((r) => ({ candidacyId: r.candidacyId, name: r.name, email: r.email, college: r.college, percent: r.a.percent, passed: r.a.passed, reviewStatus: r.a.reviewStatus, focusLosses: r.a.focusLosses, minutes: r.a.submittedAt ? Math.round((r.a.submittedAt.getTime() - r.a.startedAt.getTime()) / 60_000) : null, score: r.a.score as ScreeningScore })),
  };
}

export async function screeningForCandidacies(ids: string[]) {
  if (!ids.length) return new Map<string, Attempt>();
  const rows = await db.select().from(schema.screeningAttempts).where(inArray(schema.screeningAttempts.candidacyId, ids));
  return new Map(rows.map((r) => [r.candidacyId, r]));
}
