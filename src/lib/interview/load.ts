import { KB_INLINE_LIMIT } from "../core/kb";
import { ensureKbIndexed } from "../services/kb";
import { and, asc, eq, lt } from "drizzle-orm";
import { db, schema } from "../db";
import type { DriveConfig, RoundType } from "../core/types";
import type { SessionState } from "../core/interview";
import type { ResumeAnalysis } from "../ai/analyzers";
import { getSettings } from "../settings";
import { enabledRounds } from "../core/rounds";
import { isPractice, practiceRound } from "../core/practice";

export type SessionRow = typeof schema.roundSessions.$inferSelect;
export type MessageRow = typeof schema.messages.$inferSelect;
export type RepoRow = typeof schema.repositories.$inferSelect;

export interface PriorRoundSummary {
  roundType: RoundType;
  summary: string;
  strengths: string[];
  concerns: string[];
  focusAreas: string[];
}

/** Everything the orchestrator needs about a session's context. */
export async function loadSessionContext(sessionId: string) {
  const [row] = await db
    .select({ session: schema.roundSessions, candidacy: schema.candidacies, candidate: schema.candidates, version: schema.driveVersions })
    .from(schema.roundSessions)
    .innerJoin(schema.candidacies, eq(schema.roundSessions.candidacyId, schema.candidacies.id))
    .innerJoin(schema.candidates, eq(schema.candidacies.candidateId, schema.candidates.id))
    .innerJoin(schema.driveVersions, eq(schema.candidacies.driveVersionId, schema.driveVersions.id))
    .where(eq(schema.roundSessions.id, sessionId));
  if (!row) return null;
  const config = row.version.config as DriveConfig;
  const practice = isPractice(row.session.roundIndex);
  const round = practice ? practiceRound(config) : enabledRounds(config)[row.session.roundIndex];
  const [resume] = await db.select().from(schema.resumes).where(eq(schema.resumes.candidacyId, row.candidacy.id));
  const repos = await db.select().from(schema.repositories).where(eq(schema.repositories.candidacyId, row.candidacy.id));
  const priorReports = await db
    .select()
    .from(schema.roundReports)
    .where(and(eq(schema.roundReports.candidacyId, row.candidacy.id), lt(schema.roundReports.roundIndex, row.session.roundIndex)))
    .orderBy(asc(schema.roundReports.roundIndex));
  const prior: PriorRoundSummary[] = priorReports
    .filter((r) => r.status === "ready")
    .map((r) => ({
      roundType: r.roundType as RoundType,
      summary: r.summary ?? "",
      strengths: (r.strengths as string[]) ?? [],
      concerns: (r.concerns as string[]) ?? [],
      focusAreas: ((r.roundSpecific as { focusAreas?: string[] })?.focusAreas ?? []) as string[],
    }));
  const settings = await getSettings(row.candidacy.orgId);
  const kb = round?.type === "hr" && !practice ? await db.select().from(schema.kbDocuments).where(eq(schema.kbDocuments.orgId, row.candidacy.orgId)).orderBy(asc(schema.kbDocuments.title)) : [];
  // Small knowledge bases go whole into the cached dossier; large ones are searched per question (passages).
  const kbMode: "inline" | "retrieval" = kb.reduce((n, d) => n + d.content.length + d.title.length, 0) > KB_INLINE_LIMIT ? "retrieval" : "inline";
  if (kbMode === "retrieval") await ensureKbIndexed(row.candidacy.orgId);
  const [fit] = await db.select().from(schema.practicalFit).where(eq(schema.practicalFit.candidacyId, row.candidacy.id));
  return {
    practice,
    session: row.session,
    state: row.session.state as SessionState,
    candidacy: row.candidacy,
    candidate: row.candidate,
    config,
    round,
    resume: resume ?? null,
    analysis: resume?.parsed
      ? ({ profile: resume.parsed, jdMatch: resume.jdMatch, claims: resume.claims ?? [], riskSignals: resume.riskSignals ?? [] } as ResumeAnalysis)
      : null,
    repos,
    prior,
    settings,
    kb,
    kbMode,
    practicalFit: fit ?? null,
  };
}

export type SessionContext = NonNullable<Awaited<ReturnType<typeof loadSessionContext>>>;

export async function loadMessages(sessionId: string): Promise<MessageRow[]> {
  return db.select().from(schema.messages).where(eq(schema.messages.sessionId, sessionId)).orderBy(asc(schema.messages.seq));
}
