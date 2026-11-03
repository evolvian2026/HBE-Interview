/**
 * Quality of hire: a hire record is created when an offer is recorded (with the interview signals frozen at that
 * moment); recruiters confirm joining and the manager; the manager rates the hire at 90 and 180 days without seeing
 * the interview scores; the quality page relates the two. Hire records outlive the candidate's interview data in
 * anonymised form (no name; notes cleared) so the analysis keeps its history.
 */
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { HttpError, canSeeDrive, hasRole, type StaffUser } from "../auth/staff";
import { audit } from "../audit";
import { CHECKPOINTS, REMIND_EVERY_DAYS, dueDate, qualityStats, type Checkpoint, type HireOutcome, type HireSnapshot } from "../core/quality";
import { isHireSide } from "../core/calibration";
import type { Recommendation } from "../core/types";

type HireRow = typeof schema.hires.$inferSelect;
const actor = (u: StaffUser) => ({ type: "staff" as const, id: u.id, orgId: u.orgId });

/* ------------------------------ Hire records ------------------------------ */

/** The interview signals at the moment of the offer. */
async function snapshotFor(candidacyId: string): Promise<HireSnapshot> {
  const [combined] = await db.select().from(schema.combinedReports).where(eq(schema.combinedReports.candidacyId, candidacyId));
  const reports = await db.select({ type: schema.roundReports.roundType, score: schema.roundReports.roundScore, status: schema.roundReports.status }).from(schema.roundReports).where(eq(schema.roundReports.candidacyId, candidacyId));
  const roundScores: HireSnapshot["roundScores"] = {};
  for (const r of reports) if (r.status === "ready" && r.score != null) roundScores[r.type as keyof HireSnapshot["roundScores"]] = r.score;
  const cards = await db
    .select({ rec: schema.panelScorecards.recommendation })
    .from(schema.panelScorecards)
    .innerJoin(schema.panelInterviews, eq(schema.panelScorecards.interviewId, schema.panelInterviews.id))
    .where(and(eq(schema.panelInterviews.candidacyId, candidacyId), sql`${schema.panelScorecards.submittedAt} is not null`, sql`${schema.panelInterviews.status} <> 'cancelled'`));
  const recs = cards.map((c) => c.rec).filter((r): r is string => !!r);
  return {
    finalScore: combined?.status === "ready" ? combined.finalScore : null,
    aiRecommendation: combined?.status === "ready" ? (combined.recommendation as Recommendation) : null,
    roundScores,
    panelHireShare: recs.length ? recs.filter((r) => isHireSide(r as Recommendation)).length / recs.length : null,
  };
}

/** Called when an offer is recorded (idempotent). */
export async function ensureHire(candidacyId: string) {
  const [c] = await db
    .select({ c: schema.candidacies, d: schema.drives })
    .from(schema.candidacies)
    .innerJoin(schema.drives, eq(schema.candidacies.driveId, schema.drives.id))
    .where(eq(schema.candidacies.id, candidacyId));
  if (!c) return null;
  const [existing] = await db.select().from(schema.hires).where(eq(schema.hires.candidacyId, candidacyId));
  if (existing) return existing;
  const [h] = await db
    .insert(schema.hires)
    .values({ orgId: c.c.orgId, candidacyId, driveId: c.d.id, roleTitle: c.d.title, snapshot: await snapshotFor(candidacyId) })
    .onConflictDoNothing()
    .returning();
  return h ?? null;
}

/** Offers recorded before this feature existed get a hire record too. */
async function syncOffers(orgId: string) {
  const missing = await db
    .select({ id: schema.candidacies.id })
    .from(schema.candidacies)
    .leftJoin(schema.hires, eq(schema.hires.candidacyId, schema.candidacies.id))
    .where(and(eq(schema.candidacies.orgId, orgId), eq(schema.candidacies.stage, "offer"), isNull(schema.hires.id)))
    .limit(200);
  for (const m of missing) await ensureHire(m.id);
}

async function ownHire(user: StaffUser, id: string): Promise<HireRow> {
  const [h] = await db.select().from(schema.hires).where(and(eq(schema.hires.id, id), eq(schema.hires.orgId, user.orgId)));
  if (!h) throw new HttpError(404, "Hire not found");
  return h;
}

async function requireManagerCandidate(orgId: string, managerId: string) {
  const [m] = await db.select({ id: schema.users.id, role: schema.users.role, active: schema.users.active }).from(schema.users).where(and(eq(schema.users.id, managerId), eq(schema.users.orgId, orgId)));
  if (!m || !m.active || m.role === "viewer") throw new HttpError(400, "Choose an active colleague (not a viewer) as the manager.");
}

export async function markJoined(user: StaffUser, id: string, input: { joinedAt: Date; managerId: string }) {
  const h = await ownHire(user, id);
  if (h.status === "left") throw new HttpError(409, "This person has already left.");
  if (input.joinedAt.getTime() > Date.now() + 180 * 86_400_000) throw new HttpError(400, "The joining date is too far ahead.");
  await requireManagerCandidate(user.orgId, input.managerId);
  await db.update(schema.hires).set({ status: "joined", joinedAt: input.joinedAt, managerId: input.managerId, updatedAt: new Date() }).where(eq(schema.hires.id, id));
  for (const cp of CHECKPOINTS) {
    await db
      .insert(schema.hireReviews)
      .values({ hireId: id, orgId: user.orgId, checkpoint: cp, dueAt: dueDate(input.joinedAt, cp), reviewerId: input.managerId })
      .onConflictDoUpdate({ target: [schema.hireReviews.hireId, schema.hireReviews.checkpoint], set: { dueAt: dueDate(input.joinedAt, cp), reviewerId: sql`case when ${schema.hireReviews.submittedAt} is null then ${input.managerId}::uuid else ${schema.hireReviews.reviewerId} end` } });
  }
  await audit(actor(user), "hire.joined", "hire", id, { joinedAt: input.joinedAt.toISOString().slice(0, 10), managerId: input.managerId });
}

export async function markDeclined(user: StaffUser, id: string) {
  const h = await ownHire(user, id);
  if (h.status !== "offered") throw new HttpError(409, "Only an open offer can be marked as declined.");
  await db.update(schema.hires).set({ status: "declined", updatedAt: new Date() }).where(eq(schema.hires.id, id));
  await audit(actor(user), "hire.declined", "hire", id);
}

export async function markLeft(user: StaffUser, id: string, input: { leftAt: Date; reason: "resigned" | "let_go" | "other" }) {
  const h = await ownHire(user, id);
  if (h.status !== "joined" || !h.joinedAt) throw new HttpError(409, "Only someone who joined can be marked as having left.");
  if (input.leftAt < h.joinedAt) throw new HttpError(400, "The leaving date is before the joining date.");
  await db.update(schema.hires).set({ status: "left", leftAt: input.leftAt, leftReason: input.reason, updatedAt: new Date() }).where(eq(schema.hires.id, id));
  // Reviews that would fall after they left are no longer needed.
  await db.delete(schema.hireReviews).where(and(eq(schema.hireReviews.hireId, id), isNull(schema.hireReviews.submittedAt), sql`${schema.hireReviews.dueAt} > ${input.leftAt}`));
  await audit(actor(user), "hire.left", "hire", id, { reason: input.reason });
}

/* --------------------------------- Lists --------------------------------- */

function canSeeHire(user: StaffUser, h: { managerId: string | null; driveId: string | null }) {
  if (hasRole(user, "recruiter")) return true;
  return h.managerId === user.id || (!!h.driveId && canSeeDrive(user, { id: h.driveId, orgId: user.orgId }));
}

export async function listHires(user: StaffUser) {
  if (hasRole(user, "recruiter")) await syncOffers(user.orgId);
  const rows = await db
    .select({ h: schema.hires, name: schema.candidates.name, manager: schema.users.name })
    .from(schema.hires)
    .leftJoin(schema.candidacies, eq(schema.hires.candidacyId, schema.candidacies.id))
    .leftJoin(schema.candidates, eq(schema.candidacies.candidateId, schema.candidates.id))
    .leftJoin(schema.users, eq(schema.hires.managerId, schema.users.id))
    .where(eq(schema.hires.orgId, user.orgId))
    .orderBy(desc(schema.hires.createdAt));
  const visible = rows.filter((r) => canSeeHire(user, r.h));
  const reviews = visible.length ? await db.select().from(schema.hireReviews).where(inArray(schema.hireReviews.hireId, visible.map((r) => r.h.id))).orderBy(asc(schema.hireReviews.checkpoint)) : [];
  return visible.map((r) => ({ ...r.h, name: r.name ?? "Former candidate (interview data deleted)", manager: r.manager, reviews: reviews.filter((x) => x.hireId === r.h.id) }));
}

export async function staffChoices(orgId: string) {
  return db
    .select({ id: schema.users.id, name: schema.users.name, role: schema.users.role })
    .from(schema.users)
    .where(and(eq(schema.users.orgId, orgId), eq(schema.users.active, true), sql`${schema.users.role} <> 'viewer'`))
    .orderBy(asc(schema.users.name));
}

/* -------------------------------- Reviews -------------------------------- */

async function reviewRow(user: StaffUser, reviewId: string) {
  const [r] = await db
    .select({ r: schema.hireReviews, h: schema.hires, name: schema.candidates.name })
    .from(schema.hireReviews)
    .innerJoin(schema.hires, eq(schema.hireReviews.hireId, schema.hires.id))
    .leftJoin(schema.candidacies, eq(schema.hires.candidacyId, schema.candidacies.id))
    .leftJoin(schema.candidates, eq(schema.candidacies.candidateId, schema.candidates.id))
    .where(and(eq(schema.hireReviews.id, reviewId), eq(schema.hireReviews.orgId, user.orgId)));
  if (!r) throw new HttpError(404, "Review not found");
  if (r.r.reviewerId !== user.id && user.role !== "admin") throw new HttpError(403, "Only the hire's manager (or an admin) can give this review.");
  return r;
}

/** The review form deliberately leaves out the interview scores, so they can't colour the rating. */
export async function reviewForm(user: StaffUser, reviewId: string) {
  const r = await reviewRow(user, reviewId);
  return { review: r.r, hire: { id: r.h.id, name: r.name ?? "Former candidate", roleTitle: r.h.roleTitle, joinedAt: r.h.joinedAt, status: r.h.status }, snapshot: r.r.submittedAt ? (r.h.snapshot as HireSnapshot) : null };
}

export interface ReviewInput {
  rating: number;
  technical?: number | null;
  collaboration?: number | null;
  values?: number | null;
  wouldRehire: "yes" | "no" | "unsure";
  note?: string;
}

export async function submitReview(user: StaffUser, reviewId: string, input: ReviewInput) {
  const r = await reviewRow(user, reviewId);
  if (r.h.status !== "joined") throw new HttpError(409, "Reviews are for people who joined and are still here.");
  if (r.r.dueAt.getTime() - Date.now() > 14 * 86_400_000) throw new HttpError(409, `This review opens on ${new Date(r.r.dueAt.getTime() - 14 * 86_400_000).toDateString()}.`);
  if (r.r.submittedAt && Date.now() - r.r.submittedAt.getTime() > 14 * 86_400_000) throw new HttpError(409, "This review was submitted more than 14 days ago and can no longer be changed.");
  await db
    .update(schema.hireReviews)
    .set({ rating: input.rating, technical: input.technical ?? null, collaboration: input.collaboration ?? null, values: input.values ?? null, wouldRehire: input.wouldRehire, note: input.note?.trim() || null, submittedAt: new Date(), reviewerId: r.r.reviewerId ?? user.id })
    .where(eq(schema.hireReviews.id, reviewId));
  await audit(actor(user), "hire.review", "hire", r.h.id, { checkpoint: r.r.checkpoint, rating: input.rating });
}

/** Reviews this person should give now (due, or opening within 14 days). */
export async function reviewsDueFor(user: StaffUser) {
  return db
    .select({ id: schema.hireReviews.id, checkpoint: schema.hireReviews.checkpoint, dueAt: schema.hireReviews.dueAt, roleTitle: schema.hires.roleTitle, name: schema.candidates.name })
    .from(schema.hireReviews)
    .innerJoin(schema.hires, eq(schema.hireReviews.hireId, schema.hires.id))
    .leftJoin(schema.candidacies, eq(schema.hires.candidacyId, schema.candidacies.id))
    .leftJoin(schema.candidates, eq(schema.candidacies.candidateId, schema.candidates.id))
    .where(and(eq(schema.hireReviews.orgId, user.orgId), eq(schema.hireReviews.reviewerId, user.id), isNull(schema.hireReviews.submittedAt), eq(schema.hires.status, "joined"), lte(schema.hireReviews.dueAt, new Date(Date.now() + 14 * 86_400_000))))
    .orderBy(asc(schema.hireReviews.dueAt));
}

/** Offers older than two weeks with no joining (or decline) recorded, for recruiters. */
export async function offersToConfirm(orgId: string) {
  return db
    .select({ id: schema.hires.id, roleTitle: schema.hires.roleTitle, createdAt: schema.hires.createdAt, name: schema.candidates.name })
    .from(schema.hires)
    .leftJoin(schema.candidacies, eq(schema.hires.candidacyId, schema.candidacies.id))
    .leftJoin(schema.candidates, eq(schema.candidacies.candidateId, schema.candidates.id))
    .where(and(eq(schema.hires.orgId, orgId), eq(schema.hires.status, "offered"), lte(schema.hires.createdAt, new Date(Date.now() - 14 * 86_400_000))))
    .orderBy(asc(schema.hires.createdAt));
}

/** Daily: remind managers of reviews that are due (at most weekly). */
export async function sendReviewReminders(now = new Date()) {
  const due = await db
    .select({ r: schema.hireReviews, h: schema.hires, email: schema.users.email, reviewer: schema.users.name, active: schema.users.active })
    .from(schema.hireReviews)
    .innerJoin(schema.hires, eq(schema.hireReviews.hireId, schema.hires.id))
    .innerJoin(schema.users, eq(schema.hireReviews.reviewerId, schema.users.id))
    .where(
      and(
        isNull(schema.hireReviews.submittedAt),
        eq(schema.hires.status, "joined"),
        lte(schema.hireReviews.dueAt, now),
        or(isNull(schema.hireReviews.remindedAt), lte(schema.hireReviews.remindedAt, new Date(now.getTime() - REMIND_EVERY_DAYS * 86_400_000))),
      ),
    )
    .limit(100);
  const { sendEmail } = await import("./notify");
  const { env } = await import("../env");
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  for (const d of due) {
    if (!d.active) continue;
    await db.update(schema.hireReviews).set({ remindedAt: now }).where(eq(schema.hireReviews.id, d.r.id));
    await sendEmail(d.email, `A ${d.r.checkpoint}-day check-in is due (${d.h.roleTitle})`, `<p>Hi ${esc(d.reviewer)},</p><p>Your new ${esc(d.h.roleTitle)} hire reached ${d.r.checkpoint} days. Please take two minutes to rate how they're doing — it helps your team see which interview signals actually predict success.</p><p><a href="${env.appBaseUrl}/app/hires/review/${d.r.id}">Give the ${d.r.checkpoint}-day review</a></p>`).catch((e) => console.error("hire review reminder failed", e));
  }
  return due.length;
}

/* ------------------------------ Quality stats ------------------------------ */

export async function qualityData(user: StaffUser, opts: { driveId?: string } = {}) {
  if (!hasRole(user, "recruiter")) throw new HttpError(403, "Recruiters and admins see quality of hire.");
  await syncOffers(user.orgId);
  const hires = await db.select().from(schema.hires).where(and(eq(schema.hires.orgId, user.orgId), opts.driveId ? eq(schema.hires.driveId, opts.driveId) : undefined));
  const reviews = hires.length
    ? await db.select().from(schema.hireReviews).where(and(inArray(schema.hireReviews.hireId, hires.map((h) => h.id)), sql`${schema.hireReviews.submittedAt} is not null`)).orderBy(desc(schema.hireReviews.checkpoint))
    : [];
  const outcomes: (HireOutcome & { id: string; roleTitle: string })[] = hires
    .filter((h) => h.status !== "declined")
    .map((h) => {
      const latest = reviews.find((r) => r.hireId === h.id);
      return {
        id: h.id,
        roleTitle: h.roleTitle,
        snapshot: h.snapshot as HireSnapshot,
        rating: latest?.rating ?? null,
        wouldRehire: (latest?.wouldRehire as HireOutcome["wouldRehire"]) ?? null,
        joined: h.status === "joined" || h.status === "left",
        leftEarly: h.status === "left" && !!h.joinedAt && !!h.leftAt && h.leftAt.getTime() - h.joinedAt.getTime() < 90 * 86_400_000,
      };
    });
  const drives = await db.selectDistinct({ id: schema.drives.id, title: schema.drives.title }).from(schema.hires).innerJoin(schema.drives, eq(schema.hires.driveId, schema.drives.id)).where(eq(schema.hires.orgId, user.orgId));
  return { stats: qualityStats(outcomes), outcomes, drives, declined: hires.filter((h) => h.status === "declined").length };
}

/** When a candidacy's data is deleted, its hire record stays for the statistics without anything identifying. */
export async function anonymiseHire(candidacyId: string) {
  const [h] = await db.select({ id: schema.hires.id }).from(schema.hires).where(eq(schema.hires.candidacyId, candidacyId));
  if (!h) return;
  await db.update(schema.hireReviews).set({ note: null }).where(eq(schema.hireReviews.hireId, h.id));
}

export async function hireForCandidacy(candidacyId: string) {
  const [h] = await db.select().from(schema.hires).where(eq(schema.hires.candidacyId, candidacyId));
  if (!h) return null;
  const reviews = await db.select().from(schema.hireReviews).where(eq(schema.hireReviews.hireId, h.id)).orderBy(asc(schema.hireReviews.checkpoint));
  return { ...h, reviews };
}

export type { Checkpoint };
