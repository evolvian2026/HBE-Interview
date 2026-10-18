import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import { HttpError } from "../auth/staff";
import { audit } from "../audit";
import { draftCandidateFeedback, type CandidateFeedbackSummary } from "../ai/feedback";
import { cohortStats, meanRating, type CohortStat } from "../core/fairness";
import { languageInfo } from "../core/languages";
import { ROUND_LABEL, type RoundType } from "../core/types";

/* ------------------------------ Candidate survey ----------------------------- */

export interface SurveyInput {
  roundIndex: number;
  overall: number;
  fairness?: number | null;
  clarity?: number | null;
  technical?: number | null;
  comment?: string | null;
}

/** The most recent ended round the candidate hasn't rated yet (null when nothing is pending). */
export async function pendingSurveyRound(candidacyId: string): Promise<number | null> {
  const ended = await db
    .select({ roundIndex: schema.roundSessions.roundIndex })
    .from(schema.roundSessions)
    .where(and(eq(schema.roundSessions.candidacyId, candidacyId), eq(schema.roundSessions.status, "ended"), gte(schema.roundSessions.roundIndex, 0)))
    .orderBy(asc(schema.roundSessions.roundIndex));
  if (!ended.length) return null;
  const rated = new Set(
    (await db.select({ r: schema.candidateFeedback.roundIndex }).from(schema.candidateFeedback).where(eq(schema.candidateFeedback.candidacyId, candidacyId))).map((x) => x.r),
  );
  const last = ended[ended.length - 1].roundIndex;
  return rated.has(last) ? null : last;
}

export async function submitSurvey(candidacyId: string, input: SurveyInput) {
  const [session] = await db
    .select()
    .from(schema.roundSessions)
    .where(and(eq(schema.roundSessions.candidacyId, candidacyId), eq(schema.roundSessions.roundIndex, input.roundIndex)));
  if (!session || session.status !== "ended") throw new HttpError(409, "You can rate a round once it has ended.");
  const [existing] = await db
    .select({ id: schema.candidateFeedback.id })
    .from(schema.candidateFeedback)
    .where(and(eq(schema.candidateFeedback.candidacyId, candidacyId), eq(schema.candidateFeedback.roundIndex, input.roundIndex)));
  if (existing) throw new HttpError(409, "Thanks — you've already rated this round.");
  await db.insert(schema.candidateFeedback).values({
    candidacyId,
    roundIndex: input.roundIndex,
    overall: input.overall,
    fairness: input.fairness ?? null,
    clarity: input.clarity ?? null,
    technical: input.technical ?? null,
    comment: input.comment?.trim() || null,
  });
}

/* ----------------------- Candidate-facing feedback summary ------------------- */

export type ReleasedFeedback = CandidateFeedbackSummary;

/** Draft (or re-draft) the candidate-facing summary from ready round reports. Not visible until released. */
export async function draftFeedbackSummary(candidacyId: string, userId: string) {
  const [row] = await db
    .select({ c: schema.candidacies, title: schema.drives.title })
    .from(schema.candidacies)
    .innerJoin(schema.drives, eq(schema.candidacies.driveId, schema.drives.id))
    .where(eq(schema.candidacies.id, candidacyId));
  if (!row) throw new HttpError(404, "Candidate not found");
  const reports = (await db.select().from(schema.roundReports).where(eq(schema.roundReports.candidacyId, candidacyId)).orderBy(asc(schema.roundReports.roundIndex))).filter(
    (r) => r.status === "ready",
  );
  if (!reports.length) throw new HttpError(409, "No evaluated rounds yet.");
  // Only narrative fields — scores, recommendations, knockouts and integrity never reach the drafter.
  const roundsText = reports
    .map((r) => {
      const strengths = ((r.strengths as string[] | null) ?? []).map((s) => `  + ${s}`).join("\n");
      const concerns = ((r.concerns as string[] | null) ?? []).map((s) => `  - ${s}`).join("\n");
      return `### ${ROUND_LABEL[r.roundType as RoundType] ?? r.roundType}\n${r.summary ?? ""}\nStrengths:\n${strengths || "  (none)"}\nAreas to develop:\n${concerns || "  (none)"}`;
    })
    .join("\n\n");
  const summary = await draftCandidateFeedback({ roleTitle: row.title, roundsText, ctx: { candidacyId } });
  await db.update(schema.candidacies).set({ feedbackSummary: summary, feedbackReleasedAt: null, updatedAt: new Date() }).where(eq(schema.candidacies.id, candidacyId));
  await audit({ type: "staff", id: userId }, "feedback.draft", "candidacy", candidacyId);
  return summary;
}

/** Save recruiter edits and optionally release (or withdraw) the summary to the candidate. */
export async function saveFeedbackSummary(candidacyId: string, summary: CandidateFeedbackSummary, release: boolean, userId: string) {
  await db
    .update(schema.candidacies)
    .set({ feedbackSummary: summary, feedbackReleasedAt: release ? new Date() : null, updatedAt: new Date() })
    .where(eq(schema.candidacies.id, candidacyId));
  await audit({ type: "staff", id: userId }, release ? "feedback.release" : "feedback.save", "candidacy", candidacyId);
}

/* ------------------------------- Fairness monitor ---------------------------- */

const PASS = new Set(["strong_hire", "hire"]);

export interface FairnessDimension {
  key: string;
  label: string;
  help: string;
  stats: CohortStat[];
}

/**
 * Round-level outcomes for one drive, split by process cohorts. "Pass" = the round's AI recommendation is
 * Hire or Strong Hire. Also reports evaluator-run disagreement and candidate survey ratings per cohort.
 */
export async function driveFairness(driveId: string) {
  const rows = await db
    .select({
      candidacyId: schema.candidacies.id,
      roundType: schema.roundReports.roundType,
      score: schema.roundReports.roundScore,
      recommendation: schema.roundReports.recommendation,
      runs: schema.roundReports.runs,
      roundIndex: schema.roundReports.roundIndex,
      mode: schema.roundSessions.mode,
      language: schema.roundSessions.language,
      version: schema.driveVersions.version,
    })
    .from(schema.roundReports)
    .innerJoin(schema.roundSessions, eq(schema.roundReports.sessionId, schema.roundSessions.id))
    .innerJoin(schema.candidacies, eq(schema.roundReports.candidacyId, schema.candidacies.id))
    .innerJoin(schema.driveVersions, eq(schema.candidacies.driveVersionId, schema.driveVersions.id))
    .where(and(eq(schema.candidacies.driveId, driveId), eq(schema.roundReports.status, "ready")));

  const ids = [...new Set(rows.map((r) => r.candidacyId))];
  const openIds = new Set(
    ids.length
      ? (
          await db
            .select({ id: schema.auditLog.entityId })
            .from(schema.auditLog)
            .where(and(eq(schema.auditLog.action, "candidacy.register"), inArray(schema.auditLog.entityId, ids)))
        ).map((x) => x.id)
      : [],
  );
  const ocrIds = new Set(
    ids.length
      ? (await db.select({ id: schema.resumes.candidacyId }).from(schema.resumes).where(and(inArray(schema.resumes.candidacyId, ids), eq(schema.resumes.ocrUsed, true)))).map((x) => x.id)
      : [],
  );
  const surveys = ids.length ? await db.select().from(schema.candidateFeedback).where(inArray(schema.candidateFeedback.candidacyId, ids)) : [];

  const obs = rows.map((r) => ({
    ...r,
    passed: PASS.has(r.recommendation ?? ""),
    disagreed: Array.isArray(r.runs) && r.runs.length > 2,
    source: openIds.has(r.candidacyId) ? "Open link" : "Direct invite",
    resume: ocrIds.has(r.candidacyId) ? "Scanned (OCR)" : "Text resume",
  }));

  const dims: { key: string; label: string; help: string; of: (o: (typeof obs)[number]) => string }[] = [
    { key: "mode", label: "Input mode", help: "Text vs voice answers.", of: (o) => (o.mode === "voice" ? "Voice" : "Text") },
    { key: "language", label: "Interview language", help: "Language the round was conducted in.", of: (o) => languageInfo(o.language).label },
    { key: "source", label: "How they applied", help: "Open application link vs recruiter invite.", of: (o) => o.source },
    { key: "resume", label: "Resume format", help: "Scanned resumes are transcribed by OCR first.", of: (o) => o.resume },
    { key: "version", label: "Drive version", help: "Configuration changes between published versions.", of: (o) => `v${o.version}` },
    { key: "round", label: "Round", help: "Pass rates per round type (expected to differ; shown for context).", of: (o) => ROUND_LABEL[o.roundType as RoundType] ?? o.roundType },
  ];
  const dimensions: FairnessDimension[] = dims.map((d) => ({
    key: d.key,
    label: d.label,
    help: d.help,
    stats: cohortStats(obs.map((o) => ({ cohort: d.of(o), passed: o.passed, score: o.score }))),
  }));

  // Survey ratings and evaluator disagreement, by input mode and language (where candidate experience may differ).
  const sessionKey = (cid: string, idx: number | null) => `${cid}:${idx}`;
  const cohortOfSession = new Map(obs.map((o) => [sessionKey(o.candidacyId, o.roundIndex), { mode: o.mode === "voice" ? "Voice" : "Text", language: languageInfo(o.language).label }]));
  const experience = (["mode", "language"] as const).map((k) => {
    const groups = new Map<string, { overall: number[]; fairness: (number | null)[]; disagreed: number; n: number }>();
    for (const o of obs) {
      const c = k === "mode" ? (o.mode === "voice" ? "Voice" : "Text") : languageInfo(o.language).label;
      const g = groups.get(c) ?? { overall: [], fairness: [], disagreed: 0, n: 0 };
      g.n++;
      if (o.disagreed) g.disagreed++;
      groups.set(c, g);
    }
    for (const s of surveys) {
      const c = cohortOfSession.get(sessionKey(s.candidacyId, s.roundIndex));
      if (!c) continue;
      const g = groups.get(c[k]);
      if (!g) continue;
      g.overall.push(s.overall);
      g.fairness.push(s.fairness);
    }
    return {
      key: k,
      label: k === "mode" ? "Input mode" : "Interview language",
      rows: [...groups.entries()].map(([cohort, g]) => ({
        cohort,
        rounds: g.n,
        disagreementRate: g.n ? g.disagreed / g.n : null,
        responses: g.overall.length,
        overall: meanRating(g.overall),
        fairness: meanRating(g.fairness),
      })),
    };
  });

  return {
    rounds: obs.length,
    candidates: ids.length,
    disagreementRate: obs.length ? obs.filter((o) => o.disagreed).length / obs.length : null,
    dimensions,
    experience,
    survey: {
      responses: surveys.length,
      overall: meanRating(surveys.map((s) => s.overall)),
      fairness: meanRating(surveys.map((s) => s.fairness)),
      clarity: meanRating(surveys.map((s) => s.clarity)),
      technical: meanRating(surveys.map((s) => s.technical)),
      comments: surveys
        .filter((s) => s.comment)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 10)
        .map((s) => ({ comment: s.comment as string, overall: s.overall, at: s.createdAt })),
    },
  };
}
