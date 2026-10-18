import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import { HttpError, type StaffUser } from "../auth/staff";
import { audit } from "../audit";
import { getSettings } from "../settings";
import { candidateLink, sendEmail } from "./notify";
import { LIMITS, type Adjustment } from "../core/interview";
import { pauseAllowance } from "../core/calibration";

export type Accommodation = typeof schema.accommodations.$inferSelect;

/** Stages in which there's no round left to adjust. */
const CLOSED = ["declined", "expired", "rejected", "completed", "shortlisted", "panel", "offer"];

export async function getAccommodation(candidacyId: string): Promise<Accommodation | null> {
  const [a] = await db.select().from(schema.accommodations).where(eq(schema.accommodations.candidacyId, candidacyId));
  return a ?? null;
}

export interface AccommodationRequest {
  extraTimePct: number;
  extraBreaks: boolean;
  details?: string;
}

/** The candidate asks for (or changes) adjustments. A changed request goes back to the hiring team. */
export async function requestAccommodation(candidacy: { id: string; orgId: string; stage: string }, req: AccommodationRequest) {
  if (CLOSED.includes(candidacy.stage) || candidacy.stage === "invited") throw new HttpError(409, "Adjustments can be requested after you accept the consent and while rounds are still ahead.");
  if (!req.extraTimePct && !req.extraBreaks && !req.details?.trim()) throw new HttpError(400, "Choose an adjustment or describe what you need.");
  const values = {
    extraTimePct: req.extraTimePct,
    extraBreaks: req.extraBreaks,
    details: req.details?.trim() || null,
    status: "pending" as const,
    approvedExtraTimePct: null,
    approvedExtraBreaks: null,
    decisionNote: null,
    decidedBy: null,
    decidedAt: null,
    updatedAt: new Date(),
  };
  await db
    .insert(schema.accommodations)
    .values({ candidacyId: candidacy.id, orgId: candidacy.orgId, ...values })
    .onConflictDoUpdate({ target: schema.accommodations.candidacyId, set: values });
  // The audit entry records that a request was made, not its (possibly health-related) content.
  await audit({ type: "candidate", id: candidacy.id }, "accommodation.request", "candidacy", candidacy.id, { extraTimePct: req.extraTimePct, extraBreaks: req.extraBreaks });
}

export interface AccommodationDecision {
  approve: boolean;
  extraTimePct?: number;
  extraBreaks?: boolean;
  note?: string;
}

/** A recruiter or admin approves (possibly adjusting what was asked) or declines. Applies to rounds not yet started. */
export async function decideAccommodation(user: StaffUser, candidacyId: string, d: AccommodationDecision) {
  const a = await getAccommodation(candidacyId);
  if (!a || a.orgId !== user.orgId) throw new HttpError(404, "No adjustment request for this candidate");
  if (!d.approve && !d.note?.trim()) throw new HttpError(400, "Tell the candidate why the request was declined");
  await db
    .update(schema.accommodations)
    .set({
      status: d.approve ? "approved" : "declined",
      approvedExtraTimePct: d.approve ? (d.extraTimePct ?? a.extraTimePct) : null,
      approvedExtraBreaks: d.approve ? (d.extraBreaks ?? a.extraBreaks) : null,
      decisionNote: d.note?.trim() || null,
      decidedBy: user.id,
      decidedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.accommodations.candidacyId, candidacyId));
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, d.approve ? "accommodation.approve" : "accommodation.decline", "candidacy", candidacyId, d.approve ? { extraTimePct: d.extraTimePct ?? a.extraTimePct, extraBreaks: d.extraBreaks ?? a.extraBreaks } : undefined);
  const [row] = await db
    .select({ email: schema.candidates.email, name: schema.candidates.name, token: schema.candidacies.accessToken, drive: schema.drives.title })
    .from(schema.candidacies)
    .innerJoin(schema.candidates, eq(schema.candidacies.candidateId, schema.candidates.id))
    .innerJoin(schema.drives, eq(schema.candidacies.driveId, schema.drives.id))
    .where(eq(schema.candidacies.id, candidacyId));
  if (row) {
    const s = await getSettings(user.orgId);
    const esc = (x: string) => x.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
    await sendEmail(
      row.email,
      `Your interview adjustment request — ${row.drive}`,
      `<p>Hi ${esc(row.name)},</p><p>${d.approve ? `Your adjustment request for <b>${esc(row.drive)}</b> at ${esc(s.companyName)} has been approved and will apply to the rounds you haven't started yet.` : `${esc(s.companyName)} couldn't approve your adjustment request for <b>${esc(row.drive)}</b>.`}</p>${d.note?.trim() ? `<p>${esc(d.note.trim())}</p>` : ""}<p><a href="${candidateLink(row.token)}">Open your interview page</a></p>`,
    ).catch((e) => console.error("accommodation email failed", e));
  }
}

/** The approved adjustment for a candidacy as it applies to a new round session, or undefined. */
export async function adjustmentFor(candidacyId: string): Promise<Adjustment | undefined> {
  const a = await getAccommodation(candidacyId);
  if (!a || a.status !== "approved") return undefined;
  const pct = a.approvedExtraTimePct ?? 0;
  const breaks = !!a.approvedExtraBreaks;
  if (!pct && !breaks) return undefined;
  return { timeFactor: 1 + pct / 100, ...pauseAllowance(breaks, LIMITS) };
}

/** Pending requests for the Decisions page (recruiters and admins). */
export async function pendingAccommodations(orgId: string, driveIds?: string[]) {
  return db
    .select({ a: schema.accommodations, name: schema.candidates.name, driveTitle: schema.drives.title, driveId: schema.drives.id })
    .from(schema.accommodations)
    .innerJoin(schema.candidacies, eq(schema.accommodations.candidacyId, schema.candidacies.id))
    .innerJoin(schema.candidates, eq(schema.candidacies.candidateId, schema.candidates.id))
    .innerJoin(schema.drives, eq(schema.candidacies.driveId, schema.drives.id))
    .where(and(eq(schema.accommodations.orgId, orgId), eq(schema.accommodations.status, "pending"), driveIds ? inArray(schema.drives.id, driveIds) : undefined));
}
