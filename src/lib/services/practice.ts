import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { PRACTICE_INDEX } from "../core/practice";

/** The candidate's practice session (at most one; retaking replaces it). */
export async function practiceSession(candidacyId: string) {
  const [s] = await db
    .select()
    .from(schema.roundSessions)
    .where(and(eq(schema.roundSessions.candidacyId, candidacyId), eq(schema.roundSessions.roundIndex, PRACTICE_INDEX)));
  return s ?? null;
}

/** What staff see about practice: only that it was taken, never the transcript. */
export async function practiceSummary(candidacyId: string) {
  const s = await practiceSession(candidacyId);
  if (!s) return null;
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.action, "practice.start"), eq(schema.auditLog.actorId, candidacyId)));
  return { status: s.status, mode: s.mode, startedAt: s.startedAt, endedAt: s.endedAt, attempts: Math.max(1, n) };
}
