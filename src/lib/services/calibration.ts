import { and, asc, desc, eq, gte, inArray, isNotNull, lt, notExists, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { HttpError, canSeeDrive, isUuid, type StaffUser } from "../auth/staff";
import { audit } from "../audit";
import { getSettings } from "../settings";
import { enabledRounds } from "../core/rounds";
import { PARAMETERS, paramLabel } from "../core/rubrics";
import { roundKnockouts, roundRecommendation, roundScore, type KnockoutResult } from "../core/scoring";
import { agreement, agreementAlerts, compareReview, recommendationAgreement, sampleReason, type AgreementStat } from "../core/calibration";
import type { DriveConfig, ParamScore, Recommendation, RoundType } from "../core/types";

/* -------------------------------- Sampling -------------------------------- */

/** After an evaluation is ready: pick it for a blind review if the organisation's sample (or low confidence) says so. */
export async function maybeSampleForCalibration(sessionId: string) {
  const [rep] = await db
    .select({ id: schema.roundReports.id, confidence: schema.roundReports.confidence, requested: schema.roundReports.calibrationRequestedAt, orgId: schema.candidacies.orgId })
    .from(schema.roundReports)
    .innerJoin(schema.candidacies, eq(schema.roundReports.candidacyId, schema.candidacies.id))
    .where(eq(schema.roundReports.sessionId, sessionId));
  if (!rep || rep.requested) return;
  const reason = sampleReason(rep.id, rep.confidence, (await getSettings(rep.orgId)).calibration);
  if (reason) await db.update(schema.roundReports).set({ calibrationRequestedAt: new Date(), calibrationReason: reason }).where(eq(schema.roundReports.id, rep.id));
}

/** A hiring manager or above asks for a blind review of a specific round. */
export async function requestCalibration(user: StaffUser, reportId: string) {
  const { report } = await loadReport(user, reportId);
  if (report.calibrationRequestedAt) return;
  await db.update(schema.roundReports).set({ calibrationRequestedAt: new Date(), calibrationReason: "requested" }).where(eq(schema.roundReports.id, reportId));
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "calibration.request", "round_report", reportId);
}

async function loadReport(user: StaffUser, reportId: string) {
  const [row] = isUuid(reportId)
    ? await db
        .select({ report: schema.roundReports, c: schema.candidacies, d: schema.drives, v: schema.driveVersions })
        .from(schema.roundReports)
        .innerJoin(schema.candidacies, eq(schema.roundReports.candidacyId, schema.candidacies.id))
        .innerJoin(schema.drives, eq(schema.candidacies.driveId, schema.drives.id))
        .innerJoin(schema.driveVersions, eq(schema.candidacies.driveVersionId, schema.driveVersions.id))
        .where(eq(schema.roundReports.id, reportId))
    : [];
  if (!row || row.c.orgId !== user.orgId) throw new HttpError(404, "Round report not found");
  if (!canSeeDrive(user, row.d)) throw new HttpError(403, "You are not assigned to this hiring drive");
  if (row.report.status !== "ready") throw new HttpError(409, "This round hasn't been evaluated yet");
  const config = row.v.config as DriveConfig;
  const round = enabledRounds(config)[row.report.roundIndex];
  if (!round) throw new HttpError(404, "Round not found");
  return { ...row, config, round };
}

/* ---------------------------------- Queue --------------------------------- */

/** Rounds waiting for a blind review that this user may do (visible drives, not yet reviewed by anyone). */
export async function calibrationQueue(user: StaffUser) {
  const rows = await db
    .select({
      reportId: schema.roundReports.id,
      roundType: schema.roundReports.roundType,
      roundIndex: schema.roundReports.roundIndex,
      reason: schema.roundReports.calibrationReason,
      requestedAt: schema.roundReports.calibrationRequestedAt,
      driveId: schema.drives.id,
      driveTitle: schema.drives.title,
      orgId: schema.drives.orgId,
    })
    .from(schema.roundReports)
    .innerJoin(schema.candidacies, eq(schema.roundReports.candidacyId, schema.candidacies.id))
    .innerJoin(schema.drives, eq(schema.candidacies.driveId, schema.drives.id))
    .where(
      and(
        eq(schema.candidacies.orgId, user.orgId),
        eq(schema.roundReports.status, "ready"),
        isNotNull(schema.roundReports.calibrationRequestedAt),
        notExists(db.select({ x: sql`1` }).from(schema.calibrationReviews).where(eq(schema.calibrationReviews.reportId, schema.roundReports.id))),
      ),
    )
    .orderBy(asc(schema.roundReports.calibrationRequestedAt))
    .limit(200);
  return rows.filter((r) => canSeeDrive(user, { id: r.driveId, orgId: r.orgId }));
}

/* ------------------------------ Blind packet ------------------------------ */

/**
 * What a reviewer sees: the role, the rubric, the transcript and the candidate's work — no AI scores, summaries,
 * flags or assessments, and no candidate name.
 */
export async function blindPacket(user: StaffUser, reportId: string) {
  const { report, c, d, config, round } = await loadReport(user, reportId);
  const msgs = await db
    .select({ seq: schema.messages.seq, role: schema.messages.role, sectionKey: schema.messages.sectionKey, content: schema.messages.content })
    .from(schema.messages)
    .where(and(eq(schema.messages.sessionId, report.sessionId), inArray(schema.messages.role, ["ai", "candidate"])))
    .orderBy(asc(schema.messages.seq));
  const [code] = await db
    .select({ language: schema.codeRuns.language, code: schema.codeRuns.code, results: schema.codeRuns.results, kind: schema.codeRuns.kind })
    .from(schema.codeRuns)
    .where(and(eq(schema.codeRuns.sessionId, report.sessionId), inArray(schema.codeRuns.kind, ["submit", "snapshot"])))
    .orderBy(sql`case when ${schema.codeRuns.kind} = 'submit' then 0 else 1 end`, desc(schema.codeRuns.createdAt))
    .limit(1);
  const written = await db
    .select({ kind: schema.exerciseResponses.kind, content: schema.exerciseResponses.content, whiteboardPng: schema.exerciseResponses.whiteboardPng })
    .from(schema.exerciseResponses)
    .where(eq(schema.exerciseResponses.sessionId, report.sessionId));
  const [mine] = await db
    .select({ id: schema.calibrationReviews.id })
    .from(schema.calibrationReviews)
    .where(and(eq(schema.calibrationReviews.reportId, reportId), eq(schema.calibrationReviews.reviewerId, user.id)));
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "calibration.open", "round_report", reportId);
  return {
    reportId,
    alias: `Candidate ${c.id.slice(0, 6).toUpperCase()}`,
    candidacyId: c.id,
    driveTitle: d.title,
    roleSummary: config.roleProfile.summary,
    mustHaveSkills: config.roleProfile.mustHaveSkills,
    roundType: round.type as RoundType,
    personaName: round.personaName,
    parameters: PARAMETERS[round.type].filter((p) => (round.weights[p.id] ?? 0) > 0).map((p) => ({ ...p, weight: round.weights[p.id] })),
    transcript: msgs,
    code: code ? { language: code.language, code: code.code, final: code.kind === "submit", passed: (code.results as { passed?: number } | null)?.passed ?? null, total: (code.results as { total?: number } | null)?.total ?? null } : null,
    written: written.map((w) => ({ kind: w.kind, content: w.content as Record<string, string>, whiteboard: w.whiteboardPng?.length ? w.whiteboardPng.toString("base64") : null })),
    alreadyReviewed: !!mine,
  };
}

/* --------------------------------- Submit --------------------------------- */

/** The AI's own scores and recommendation, ignoring any human overrides made since. */
function aiView(report: typeof schema.roundReports.$inferSelect, config: DriveConfig, round: ReturnType<typeof enabledRounds>[number]) {
  const raw = Object.fromEntries(Object.entries((report.params as Record<string, ParamScore>) ?? {}).map(([k, v]) => [k, { ...v, override: undefined }]));
  const ethicsFailed = ((report.knockouts as KnockoutResult[] | null) ?? []).some((k) => k.id === "ethics");
  const recommendation = roundRecommendation(roundScore(raw, round.weights), roundKnockouts(round.type, raw, config, { ethicsFailed }), config);
  const scores: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v.score === "number" && (round.weights[k] ?? 0) > 0) scores[k] = v.score;
  const versions = (report.versions as { evaluator?: string; prompt?: string } | null) ?? {};
  return { scores, recommendation, evaluator: versions.evaluator ?? "unknown", prompt: versions.prompt ?? "unknown" };
}

export interface ReviewInput {
  scores: Record<string, number | null>;
  recommendation: Recommendation;
  notes?: string;
}

export async function submitReview(user: StaffUser, reportId: string, input: ReviewInput) {
  const { report, c, config, round } = await loadReport(user, reportId);
  const allowed = new Set(PARAMETERS[round.type].filter((p) => (round.weights[p.id] ?? 0) > 0).map((p) => p.id));
  const scores: Record<string, number> = {};
  for (const [k, v] of Object.entries(input.scores)) {
    if (!allowed.has(k)) throw new HttpError(400, `Unknown parameter: ${k}`);
    if (v != null) scores[k] = v;
  }
  if (!Object.keys(scores).length) throw new HttpError(400, "Score at least one parameter");
  // A review is blind unless this reviewer had already opened the AI-scored report for this candidate.
  const [seen] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.actorId, user.id), eq(schema.auditLog.action, "report.view"), eq(schema.auditLog.entityId, c.id), lt(schema.auditLog.createdAt, new Date())));
  const ai = aiView(report, config, round);
  const cmp = compareReview(scores, ai.scores, input.recommendation, ai.recommendation);
  const [created] = await db
    .insert(schema.calibrationReviews)
    .values({
      orgId: c.orgId,
      reportId,
      candidacyId: c.id,
      driveId: c.driveId,
      roundType: round.type,
      reviewerId: user.id,
      scores,
      recommendation: input.recommendation,
      notes: input.notes?.trim() || null,
      ai,
      blind: !seen?.n,
      disagrees: cmp.disagrees,
    })
    .onConflictDoNothing()
    .returning();
  if (!created) throw new HttpError(409, "You've already reviewed this round");
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "calibration.review", "round_report", reportId, { disagrees: cmp.disagrees, maxGap: cmp.maxGap, blind: created.blind });
  return { review: created, comparison: cmp, ai };
}

/** A submitted review with the AI's scores side by side (the "reveal" after a reviewer submits). */
export async function reviewResult(user: StaffUser, reportId: string) {
  const { round } = await loadReport(user, reportId);
  const [r] = await db
    .select()
    .from(schema.calibrationReviews)
    .where(and(eq(schema.calibrationReviews.reportId, reportId), eq(schema.calibrationReviews.reviewerId, user.id)));
  if (!r) return null;
  const cmp = compareReview(r.scores, r.ai.scores, r.recommendation as Recommendation, r.ai.recommendation as Recommendation);
  return { review: r, comparison: cmp, labels: Object.fromEntries(PARAMETERS[round.type].map((p) => [p.id, p.label])) };
}

/** Reviews of a candidate's rounds, for the candidate report. */
export async function reviewsForCandidacy(candidacyId: string) {
  return db
    .select({ r: schema.calibrationReviews, reviewer: schema.users.name })
    .from(schema.calibrationReviews)
    .leftJoin(schema.users, eq(schema.calibrationReviews.reviewerId, schema.users.id))
    .where(eq(schema.calibrationReviews.candidacyId, candidacyId))
    .orderBy(asc(schema.calibrationReviews.createdAt));
}

/** Candidacies (of those given) with at least one review that disagrees with the AI. */
export async function disagreementsAmong(candidacyIds: string[]) {
  if (!candidacyIds.length) return new Set<string>();
  const rows = await db
    .selectDistinct({ id: schema.calibrationReviews.candidacyId })
    .from(schema.calibrationReviews)
    .where(and(inArray(schema.calibrationReviews.candidacyId, candidacyIds), eq(schema.calibrationReviews.disagrees, true)));
  return new Set(rows.map((r) => r.id));
}

/* ------------------------------- Statistics ------------------------------- */

export interface StatsFilter {
  days: number;
  driveId?: string;
  roundType?: RoundType;
  includeNonBlind?: boolean;
}

export async function calibrationReviews(user: StaffUser, f: StatsFilter) {
  const since = new Date(Date.now() - f.days * 86_400_000);
  const rows = await db
    .select({ r: schema.calibrationReviews, reviewer: schema.users.name, driveTitle: schema.drives.title })
    .from(schema.calibrationReviews)
    .innerJoin(schema.drives, eq(schema.calibrationReviews.driveId, schema.drives.id))
    .leftJoin(schema.users, eq(schema.calibrationReviews.reviewerId, schema.users.id))
    .where(
      and(
        eq(schema.calibrationReviews.orgId, user.orgId),
        gte(schema.calibrationReviews.createdAt, since),
        f.driveId && isUuid(f.driveId) ? eq(schema.calibrationReviews.driveId, f.driveId) : undefined,
        f.roundType ? eq(schema.calibrationReviews.roundType, f.roundType) : undefined,
        f.includeNonBlind ? undefined : eq(schema.calibrationReviews.blind, true),
      ),
    )
    .orderBy(desc(schema.calibrationReviews.createdAt));
  return rows;
}

export interface ParamAgreement extends AgreementStat {
  id: string;
  label: string;
}

export async function calibrationStats(user: StaffUser, f: StatsFilter) {
  const rows = await calibrationReviews(user, f);
  const byRound = new Map<RoundType, typeof rows>();
  for (const row of rows) {
    const t = row.r.roundType as RoundType;
    byRound.set(t, [...(byRound.get(t) ?? []), row]);
  }
  const alerts: string[] = [];
  const rounds = [...byRound.entries()].map(([type, list]) => {
    const params: ParamAgreement[] = PARAMETERS[type]
      .map((p) => {
        const pairs = list.filter((x) => typeof x.r.scores[p.id] === "number" && typeof x.r.ai.scores[p.id] === "number").map((x) => [x.r.ai.scores[p.id], x.r.scores[p.id]] as [number, number]);
        return { id: p.id, label: p.label, ...agreement(pairs) };
      })
      .filter((p) => p.n > 0);
    const all = agreement(list.flatMap((x) => Object.keys(x.r.scores).filter((k) => typeof x.r.ai.scores[k] === "number").map((k) => [x.r.ai.scores[k], x.r.scores[k]] as [number, number])));
    const rec = recommendationAgreement(list.map((x) => [x.r.ai.recommendation as Recommendation, x.r.recommendation as Recommendation]));
    for (const p of params) alerts.push(...agreementAlerts(`${paramLabel(type, p.id)} (${type})`, p));
    return { type, reviews: list.length, overall: all, params, rec };
  });
  const versionMap = new Map<string, [number, number][]>();
  for (const x of rows) {
    const key = `${x.r.ai.evaluator} · ${x.r.ai.prompt}`;
    const pairs = Object.keys(x.r.scores).filter((k) => typeof x.r.ai.scores[k] === "number").map((k) => [x.r.ai.scores[k], x.r.scores[k]] as [number, number]);
    versionMap.set(key, [...(versionMap.get(key) ?? []), ...pairs]);
  }
  const versions = [...versionMap.entries()].map(([version, pairs]) => ({ version, ...agreement(pairs) }));
  return {
    reviews: rows.length,
    disagreements: rows.filter((x) => x.r.disagrees).length,
    rounds,
    versions,
    alerts,
    recent: rows.filter((x) => x.r.disagrees).slice(0, 20),
  };
}
