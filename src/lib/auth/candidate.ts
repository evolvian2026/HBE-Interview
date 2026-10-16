import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db, schema } from "../db";
import { HttpError } from "./staff";

export function newAccessToken() {
  return randomBytes(24).toString("base64url");
}

/** Resolve a candidate's personal link token to their candidacy (the link is the credential). */
export async function candidacyByToken(token: string) {
  if (!token || token.length < 20) return null;
  const [row] = await db
    .select({ candidacy: schema.candidacies, candidate: schema.candidates })
    .from(schema.candidacies)
    .innerJoin(schema.candidates, eq(schema.candidacies.candidateId, schema.candidates.id))
    .where(eq(schema.candidacies.accessToken, token));
  return row ?? null;
}

export async function requireCandidacy(token: string) {
  const row = await candidacyByToken(token);
  if (!row) throw new HttpError(404, "This link is not valid");
  if (row.candidacy.expiresAt && row.candidacy.expiresAt < new Date() && row.candidacy.stage === "invited")
    throw new HttpError(410, "This invitation has expired — please contact the recruiter");
  return row;
}
