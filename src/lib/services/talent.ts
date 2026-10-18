import { and, desc, eq, gt, ilike, inArray, or, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { HttpError, canSeeDrive, isUuid, type StaffUser } from "../auth/staff";
import { audit } from "../audit";
import { enqueue } from "../jobs/queue";
import { createCandidacy } from "./candidacy";
import { sendInviteEmail } from "./notify";
import { normaliseTags, POOL_MONTHS } from "../core/insights";
import type { Recommendation } from "../core/types";
import type { ParsedResume } from "../ai/analyzers";

/* ------------------------------ Candidate side ---------------------------- */

/** The candidate opts in to (or out of) being kept on file for future roles. */
export async function setPoolConsent(candidacy: { id: string; candidateId: string }, months: number | null) {
  if (months != null && !(POOL_MONTHS as readonly number[]).includes(months)) throw new HttpError(400, "Choose 6, 12 or 24 months.");
  const now = new Date();
  const expires = months == null ? null : new Date(now.getTime() + months * 30.44 * 86_400_000);
  await db
    .update(schema.candidates)
    .set({ poolConsentAt: months == null ? null : now, poolExpiresAt: expires })
    .where(eq(schema.candidates.id, candidacy.candidateId));
  await audit({ type: "candidate", id: candidacy.id }, months == null ? "talent.pool_leave" : "talent.pool_join", "candidacy", candidacy.id, months == null ? undefined : { months });
  return expires;
}

export const poolActive = (c: { poolExpiresAt: Date | null }, now = new Date()) => !!c.poolExpiresAt && c.poolExpiresAt > now;

/* ---------------------------------- Search -------------------------------- */

export interface TalentFilter {
  q?: string;
  driveId?: string;
  stage?: string;
  recommendation?: Recommendation;
  minScore?: number;
  tag?: string;
  poolOnly?: boolean;
}

export async function searchTalent(user: StaffUser, f: TalentFilter) {
  const now = new Date();
  const q = f.q?.trim();
  const like = q ? `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
  const rows = await db
    .select({
      cand: schema.candidates,
      c: { id: schema.candidacies.id, stage: schema.candidacies.stage, createdAt: schema.candidacies.createdAt, driveId: schema.candidacies.driveId, source: schema.candidacies.source },
      d: { id: schema.drives.id, title: schema.drives.title, orgId: schema.drives.orgId },
      rec: schema.combinedReports.recommendation,
      score: schema.combinedReports.finalScore,
    })
    .from(schema.candidacies)
    .innerJoin(schema.candidates, eq(schema.candidacies.candidateId, schema.candidates.id))
    .innerJoin(schema.drives, eq(schema.candidacies.driveId, schema.drives.id))
    .leftJoin(schema.combinedReports, and(eq(schema.combinedReports.candidacyId, schema.candidacies.id), eq(schema.combinedReports.status, "ready")))
    .leftJoin(schema.resumes, eq(schema.resumes.candidacyId, schema.candidacies.id))
    .where(
      and(
        eq(schema.candidacies.orgId, user.orgId),
        like ? or(ilike(schema.candidates.name, like), ilike(schema.candidates.email, like), ilike(schema.resumes.rawText, like), sql`${schema.resumes.parsed}::text ilike ${like}`) : undefined,
        f.driveId && isUuid(f.driveId) ? eq(schema.candidacies.driveId, f.driveId) : undefined,
        f.stage ? eq(schema.candidacies.stage, f.stage) : undefined,
        f.recommendation ? eq(schema.combinedReports.recommendation, f.recommendation) : undefined,
        f.minScore != null ? sql`${schema.combinedReports.finalScore} >= ${f.minScore}` : undefined,
        f.tag ? sql`${schema.candidates.tags} @> ${JSON.stringify([f.tag.toLowerCase()])}::jsonb` : undefined,
        f.poolOnly ? gt(schema.candidates.poolExpiresAt, now) : undefined,
      ),
    )
    .orderBy(desc(schema.candidacies.createdAt))
    .limit(500);
  // One row per person: their most recent matching candidacy, plus how many they have.
  const byCandidate = new Map<string, (typeof rows)[number] & { applications: number }>();
  for (const r of rows) {
    const seen = byCandidate.get(r.cand.id);
    if (seen) seen.applications++;
    else byCandidate.set(r.cand.id, { ...r, applications: 1 });
  }
  return [...byCandidate.values()].slice(0, 100).map((r) => ({ ...r, inPool: poolActive(r.cand, now) }));
}

/* --------------------------------- Profile -------------------------------- */

async function orgCandidate(user: StaffUser, candidateId: string) {
  const [cand] = isUuid(candidateId) ? await db.select().from(schema.candidates).where(eq(schema.candidates.id, candidateId)) : [];
  if (!cand || cand.orgId !== user.orgId) throw new HttpError(404, "Candidate not found");
  return cand;
}

export async function talentProfile(user: StaffUser, candidateId: string) {
  const cand = await orgCandidate(user, candidateId);
  const apps = await db
    .select({ c: schema.candidacies, d: schema.drives, rec: schema.combinedReports.recommendation, score: schema.combinedReports.finalScore })
    .from(schema.candidacies)
    .innerJoin(schema.drives, eq(schema.candidacies.driveId, schema.drives.id))
    .leftJoin(schema.combinedReports, and(eq(schema.combinedReports.candidacyId, schema.candidacies.id), eq(schema.combinedReports.status, "ready")))
    .where(eq(schema.candidacies.candidateId, cand.id))
    .orderBy(desc(schema.candidacies.createdAt));
  const ids = apps.map((a) => a.c.id);
  const decisions = ids.length
    ? await db.select().from(schema.hiringDecisions).where(inArray(schema.hiringDecisions.candidacyId, ids)).orderBy(desc(schema.hiringDecisions.createdAt))
    : [];
  const [resume] = ids.length
    ? await db.select({ parsed: schema.resumes.parsed, createdAt: schema.resumes.createdAt }).from(schema.resumes).where(and(inArray(schema.resumes.candidacyId, ids), sql`${schema.resumes.parsed} is not null`)).orderBy(desc(schema.resumes.createdAt)).limit(1)
    : [];
  return {
    candidate: cand,
    inPool: poolActive(cand),
    applications: apps.map((a) => ({ ...a, decision: decisions.find((d) => d.candidacyId === a.c.id) ?? null, visible: canSeeDrive(user, a.d) })),
    profile: (resume?.parsed ?? null) as Pick<ParsedResume, "summary" | "skills" | "experience" | "location"> | null,
  };
}

export async function setTags(user: StaffUser, candidateId: string, tags: string[]) {
  const cand = await orgCandidate(user, candidateId);
  const next = normaliseTags(tags);
  await db.update(schema.candidates).set({ tags: next }).where(eq(schema.candidates.id, cand.id));
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "talent.tags", "candidate", cand.id, { tags: next });
  return next;
}

/** Tags in use across the organisation (for the filter). */
export async function orgTags(orgId: string) {
  const rows = await db.execute<{ tag: string }>(sql`select distinct jsonb_array_elements_text(tags) as tag from candidates where org_id = ${orgId} order by 1`);
  return rows.rows.map((r) => r.tag);
}

/* --------------------------------- Re-invite ------------------------------- */

/**
 * Invite someone from the talent pool to another drive. Their latest resume is copied and re-analysed against the new
 * role, so they consent and confirm their profile instead of uploading again.
 */
export async function reinvite(user: StaffUser, candidateId: string, driveId: string) {
  const cand = await orgCandidate(user, candidateId);
  if (!poolActive(cand)) throw new HttpError(409, "This candidate hasn't agreed to be contacted about other roles (or their consent has expired).");
  const [drive] = isUuid(driveId) ? await db.select().from(schema.drives).where(eq(schema.drives.id, driveId)) : [];
  if (!drive || !canSeeDrive(user, drive)) throw new HttpError(404, "Hiring drive not found");
  if (drive.status !== "active") throw new HttpError(400, "Publish (activate) the drive before inviting candidates.");
  const { candidacy, created } = await createCandidacy(drive, cand.name, cand.email, "reinvite");
  if (!created) throw new HttpError(409, "This candidate is already in that hiring drive.");
  const [prev] = await db
    .select({ r: schema.resumes })
    .from(schema.resumes)
    .innerJoin(schema.candidacies, eq(schema.resumes.candidacyId, schema.candidacies.id))
    .where(and(eq(schema.candidacies.candidateId, cand.id), sql`${schema.resumes.rawText} is not null`))
    .orderBy(desc(schema.resumes.createdAt))
    .limit(1);
  if (prev) {
    const [copy] = await db
      .insert(schema.resumes)
      .values({ candidacyId: candidacy.id, fileName: prev.r.fileName, mimeType: prev.r.mimeType, fileData: prev.r.fileData, rawText: prev.r.rawText, ocrUsed: prev.r.ocrUsed, status: "uploaded" })
      .returning();
    await enqueue("parse-resume", { resumeId: copy.id }, { singletonKey: `resume:${copy.id}` });
  }
  await sendInviteEmail(candidacy.id).catch((e) => console.error("invite email failed", e));
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "talent.reinvite", "candidacy", candidacy.id, { candidateId: cand.id, driveId: drive.id, resumeReused: !!prev });
  return { candidacyId: candidacy.id, resumeReused: !!prev };
}
