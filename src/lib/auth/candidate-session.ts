import { and, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { HttpError } from "./staff";
import { requireCandidacy } from "./candidate";

/** Resolve token + session id, ensuring the session belongs to this candidate. */
export async function requireCandidateSession(token: string, sessionId: string) {
  const row = await requireCandidacy(token);
  const [session] = await db
    .select()
    .from(schema.roundSessions)
    .where(and(eq(schema.roundSessions.id, sessionId), eq(schema.roundSessions.candidacyId, row.candidacy.id)));
  if (!session) throw new HttpError(404, "Session not found");
  return { ...row, session };
}
