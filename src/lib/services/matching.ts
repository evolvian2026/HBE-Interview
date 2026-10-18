import { and, desc, eq, gt, inArray, notInArray } from "drizzle-orm";
import { db, schema } from "../db";
import { HttpError, requireDriveAccess, type StaffUser } from "../auth/staff";
import { matchRole, yearsOfExperience, type MatchResult } from "../core/matching";
import type { ParsedResume } from "../ai/analyzers";
import type { DriveConfig, Recommendation } from "../core/types";
import { reinvite } from "./talent";

export const MATCH_THRESHOLD = 60;

export interface Suggestion extends MatchResult {
  candidateId: string;
  name: string;
  email: string;
  tags: string[];
  poolUntil: Date;
  lastDrive: string;
  lastStage: string;
  lastAi: Recommendation | null;
  lastAiScore: number | null;
}

/** People in the talent pool who aren't in this drive yet, ranked by fit to its role. */
export async function poolSuggestions(user: StaffUser, driveId: string, opts: { limit?: number; minScore?: number } = {}): Promise<Suggestion[]> {
  const drive = await requireDriveAccess(user, driveId);
  if (!drive.currentVersionId) return [];
  const [version] = await db.select().from(schema.driveVersions).where(eq(schema.driveVersions.id, drive.currentVersionId));
  const role = (version.config as DriveConfig).roleProfile;
  const already = db.select({ id: schema.candidacies.candidateId }).from(schema.candidacies).where(eq(schema.candidacies.driveId, drive.id));
  const pooled = await db
    .select()
    .from(schema.candidates)
    .where(and(eq(schema.candidates.orgId, user.orgId), gt(schema.candidates.poolExpiresAt, new Date()), notInArray(schema.candidates.id, already)));
  if (!pooled.length) return [];
  const ids = pooled.map((p) => p.id);
  const apps = await db
    .select({ candidateId: schema.candidacies.candidateId, createdAt: schema.candidacies.createdAt, stage: schema.candidacies.stage, drive: schema.drives.title, parsed: schema.resumes.parsed, rec: schema.combinedReports.recommendation, score: schema.combinedReports.finalScore })
    .from(schema.candidacies)
    .innerJoin(schema.drives, eq(schema.candidacies.driveId, schema.drives.id))
    .leftJoin(schema.resumes, eq(schema.resumes.candidacyId, schema.candidacies.id))
    .leftJoin(schema.combinedReports, and(eq(schema.combinedReports.candidacyId, schema.candidacies.id), eq(schema.combinedReports.status, "ready")))
    .where(inArray(schema.candidacies.candidateId, ids))
    .orderBy(desc(schema.candidacies.createdAt));
  const out: Suggestion[] = [];
  for (const p of pooled) {
    const mine = apps.filter((a) => a.candidateId === p.id);
    const resume = mine.find((a) => a.parsed)?.parsed as ParsedResume | undefined;
    if (!resume) continue;
    const m = matchRole({ skills: resume.skills.map((s) => s.name), years: yearsOfExperience(resume.experience) }, role);
    const withAi = mine.find((a) => a.rec);
    out.push({ ...m, candidateId: p.id, name: p.name, email: p.email, tags: p.tags, poolUntil: p.poolExpiresAt!, lastDrive: mine[0]?.drive ?? "", lastStage: mine[0]?.stage ?? "", lastAi: (withAi?.rec as Recommendation) ?? null, lastAiScore: withAi?.score ?? null });
  }
  return out
    .filter((s) => s.score >= (opts.minScore ?? 0))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, opts.limit ?? 10);
}

/** How many pooled people match a drive at or above the threshold (for the drive banner). */
export async function strongMatchCount(user: StaffUser, driveId: string) {
  return (await poolSuggestions(user, driveId, { limit: 1000, minScore: MATCH_THRESHOLD })).length;
}

/** Invite several pooled people to a drive; each result says what happened. */
export async function bulkReinvite(user: StaffUser, driveId: string, candidateIds: string[]) {
  await requireDriveAccess(user, driveId);
  if (candidateIds.length > 25) throw new HttpError(400, "Invite at most 25 people at a time.");
  const results: { candidateId: string; status: "invited" | "error"; message?: string }[] = [];
  for (const id of [...new Set(candidateIds)]) {
    try {
      await reinvite(user, id, driveId);
      results.push({ candidateId: id, status: "invited" });
    } catch (e) {
      results.push({ candidateId: id, status: "error", message: e instanceof HttpError ? e.message : "Something went wrong" });
    }
  }
  return results;
}

