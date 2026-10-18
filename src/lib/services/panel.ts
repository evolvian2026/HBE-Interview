import { and, asc, desc, eq, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { HttpError, canSeeDrive, hasRole, isUuid, type StaffRole, type StaffUser } from "../auth/staff";
import { audit } from "../audit";
import { getSettings } from "../settings";
import { candidateLink, sendEmail } from "./notify";
import { emitEvent } from "./integrations";
import { env } from "../env";
import { buildIcs } from "../core/ics";
import { MAX_COMPETENCIES, slotProblem, summarisePanel } from "../core/panel";
import type { Recommendation } from "../core/types";

export type PanelInterview = typeof schema.panelInterviews.$inferSelect;
export type PanelScorecard = typeof schema.panelScorecards.$inferSelect;

/** AI rounds are over (or the candidate was moved on by hand): a live panel can be arranged. */
const PANEL_STAGES = ["completed", "shortlisted", "on_hold", "panel"];
/** Stages from which a final decision can be recorded. */
const DECISION_STAGES = ["completed", "shortlisted", "on_hold", "panel", "offer", "gate_pending"];

const esc = (x: string) => x.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
const fmtUtc = (d: Date) => `${d.toUTCString().replace(":00 GMT", " UTC")}`;

async function candidacyRow(candidacyId: string) {
  const [row] = isUuid(candidacyId)
    ? await db
        .select({ c: schema.candidacies, cand: schema.candidates, d: schema.drives })
        .from(schema.candidacies)
        .innerJoin(schema.candidates, eq(schema.candidacies.candidateId, schema.candidates.id))
        .innerJoin(schema.drives, eq(schema.candidacies.driveId, schema.drives.id))
        .where(eq(schema.candidacies.id, candidacyId))
    : [];
  return row ?? null;
}

async function accessibleCandidacy(user: StaffUser, candidacyId: string) {
  const row = await candidacyRow(candidacyId);
  if (!row || row.c.orgId !== user.orgId) throw new HttpError(404, "Candidate not found");
  if (!canSeeDrive(user, row.d)) throw new HttpError(403, "You are not assigned to this hiring drive");
  return row;
}

async function loadInterview(interviewId: string) {
  const [iv] = isUuid(interviewId) ? await db.select().from(schema.panelInterviews).where(eq(schema.panelInterviews.id, interviewId)) : [];
  return iv ?? null;
}

async function panelistsOf(interviewId: string) {
  return db
    .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, card: schema.panelScorecards })
    .from(schema.panelScorecards)
    .innerJoin(schema.users, eq(schema.panelScorecards.panelistId, schema.users.id))
    .where(eq(schema.panelScorecards.interviewId, interviewId))
    .orderBy(asc(schema.users.name));
}

/* -------------------------------- Calendar -------------------------------- */

export function interviewIcs(iv: PanelInterview, who: { candidateName: string; driveTitle: string; companyName: string }, audience: "candidate" | "panel") {
  if (!iv.scheduledAt) return null;
  return buildIcs({
    uid: `panel-${iv.id}@hbe-interview`,
    start: iv.scheduledAt,
    durationMin: iv.durationMin,
    sequence: iv.sequence,
    cancelled: iv.status === "cancelled",
    summary: audience === "candidate" ? `${iv.title} — ${who.driveTitle} at ${who.companyName}` : `${iv.title}: ${who.candidateName} (${who.driveTitle})`,
    location: iv.location,
    description: audience === "candidate" ? `Your interview for ${who.driveTitle}. Details: ${env.appBaseUrl}` : `Interview kit and scorecard: ${env.appBaseUrl.replace(/\/$/, "")}/app/panel/${iv.id}`,
  });
}

/* ------------------------------- Scheduling ------------------------------- */

export interface ScheduleInput {
  title: string;
  durationMin: number;
  location: string;
  slots: string[];
  panelistIds: string[];
  competencies: string[];
}

const PANEL_ROLES: StaffRole[] = ["hiring_manager", "recruiter", "admin"];

export async function scheduleInterview(user: StaffUser, candidacyId: string, input: ScheduleInput) {
  const row = await accessibleCandidacy(user, candidacyId);
  if (!PANEL_STAGES.includes(row.c.stage)) throw new HttpError(409, "A panel interview can be arranged once the AI rounds are finished.");
  const problem = slotProblem(input.slots);
  if (problem) throw new HttpError(400, problem);
  const competencies = [...new Set(input.competencies.map((c) => c.trim()).filter(Boolean))];
  if (!competencies.length || competencies.length > MAX_COMPETENCIES) throw new HttpError(400, `Choose 1–${MAX_COMPETENCIES} competencies for the scorecard.`);
  const ids = [...new Set(input.panelistIds)];
  const panel = ids.length ? await db.select().from(schema.users).where(and(inArray(schema.users.id, ids.filter(isUuid)), eq(schema.users.orgId, user.orgId))) : [];
  if (!panel.length || panel.length !== ids.length) throw new HttpError(400, "Choose panelists from your organisation.");
  for (const p of panel) {
    if (!p.active) throw new HttpError(400, `${p.name} is deactivated.`);
    if (!PANEL_ROLES.includes(p.role as StaffRole)) throw new HttpError(400, `${p.name} is a viewer and can't sit on a panel.`);
    if (p.role === "hiring_manager" && !((p.driveIds as string[] | null) ?? []).includes(row.d.id)) throw new HttpError(400, `${p.name} isn't assigned to this hiring drive.`);
  }
  const slots = input.slots.map((s) => new Date(s).toISOString()).sort();
  const single = slots.length === 1;
  const [iv] = await db
    .insert(schema.panelInterviews)
    .values({
      orgId: user.orgId,
      candidacyId,
      title: input.title.trim(),
      durationMin: input.durationMin,
      location: input.location.trim(),
      slots,
      scheduledAt: single ? new Date(slots[0]) : null,
      status: single ? "scheduled" : "proposed",
      competencies,
      createdBy: user.id,
    })
    .returning();
  await db.insert(schema.panelScorecards).values(panel.map((p) => ({ interviewId: iv.id, panelistId: p.id })));
  await db.update(schema.candidacies).set({ stage: "panel", updatedAt: new Date() }).where(eq(schema.candidacies.id, candidacyId));
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "panel.create", "candidacy", candidacyId, { interviewId: iv.id, slots: slots.length, panelists: panel.length });
  await notifyCandidate(iv, single ? "scheduled" : "choose");
  if (single) await onScheduled(iv);
  return iv;
}

async function onScheduled(iv: PanelInterview) {
  await emitEvent(iv.orgId, "panel.scheduled", { candidacyId: iv.candidacyId, interviewId: iv.id, scheduledAt: iv.scheduledAt?.toISOString(), durationMin: iv.durationMin });
  const row = await candidacyRow(iv.candidacyId);
  if (!row) return;
  for (const p of await panelistsOf(iv.id)) {
    await sendEmail(
      p.email,
      `Panel interview: ${row.cand.name} — ${fmtUtc(iv.scheduledAt!)}`,
      `<p>Hi ${esc(p.name)},</p><p>You're on the panel for <b>${esc(row.cand.name)}</b> (${esc(row.d.title)}) on <b>${fmtUtc(iv.scheduledAt!)}</b> for ${iv.durationMin} minutes at ${esc(iv.location)}.</p><p><a href="${env.appBaseUrl.replace(/\/$/, "")}/app/panel/${iv.id}">Open the interview kit and scorecard</a> (includes a calendar file).</p><p>Please submit your scorecard before reading other panelists' feedback.</p>`,
    ).catch((e) => console.error("panel email failed", e));
  }
}

async function notifyCandidate(iv: PanelInterview, kind: "choose" | "scheduled" | "cancelled") {
  const row = await candidacyRow(iv.candidacyId);
  if (!row) return;
  const s = await getSettings(row.c.orgId);
  const link = candidateLink(row.c.accessToken);
  const body =
    kind === "choose"
      ? `<p>The hiring team at ${esc(s.companyName)} would like to meet you for a ${iv.durationMin}-minute <b>${esc(iv.title)}</b>. Please <a href="${link}">choose a time that suits you</a>.</p>`
      : kind === "scheduled"
        ? `<p>Your <b>${esc(iv.title)}</b> with ${esc(s.companyName)} is confirmed for <b>${fmtUtc(iv.scheduledAt!)}</b> (${iv.durationMin} minutes) at ${esc(iv.location)}. <a href="${link}">Your interview page</a> shows the time in your time zone and has a calendar file.</p>`
        : `<p>Your <b>${esc(iv.title)}</b> with ${esc(s.companyName)} has been cancelled. The hiring team will be in touch.</p>`;
  await sendEmail(row.cand.email, `${iv.title} — ${row.d.title}`, `<p>Hi ${esc(row.cand.name)},</p>${body}`).catch((e) => console.error("panel email failed", e));
}

/** The candidate picks one of the offered times. */
export async function chooseSlot(candidacy: { id: string }, interviewId: string, slot: string) {
  const iv = await loadInterview(interviewId);
  if (!iv || iv.candidacyId !== candidacy.id) throw new HttpError(404, "Interview not found");
  if (iv.status !== "proposed") throw new HttpError(409, iv.status === "scheduled" ? "This interview is already booked." : "These times are no longer available.");
  const iso = new Date(slot).toISOString();
  if (!iv.slots.includes(iso)) throw new HttpError(400, "Choose one of the offered times.");
  if (Date.parse(iso) < Date.now()) throw new HttpError(409, "That time has passed — please choose another or ask for new times.");
  const [updated] = await db
    .update(schema.panelInterviews)
    .set({ status: "scheduled", scheduledAt: new Date(iso), candidateMessage: null, updatedAt: new Date() })
    .where(and(eq(schema.panelInterviews.id, iv.id), eq(schema.panelInterviews.status, "proposed")))
    .returning();
  if (!updated) throw new HttpError(409, "This interview was just updated — please reload.");
  await audit({ type: "candidate", id: candidacy.id }, "panel.slot_chosen", "candidacy", candidacy.id, { interviewId: iv.id, at: iso });
  await notifyCandidate(updated, "scheduled");
  await onScheduled(updated);
  return updated;
}

/** The candidate can't make any offered time (or the booked one) and asks for others. */
export async function requestOtherTimes(candidacy: { id: string }, interviewId: string, message: string) {
  const iv = await loadInterview(interviewId);
  if (!iv || iv.candidacyId !== candidacy.id) throw new HttpError(404, "Interview not found");
  if (!["proposed", "scheduled"].includes(iv.status)) throw new HttpError(409, "This interview can't be changed now.");
  if (iv.scheduledAt && iv.scheduledAt.getTime() < Date.now()) throw new HttpError(409, "This interview has already started.");
  await db
    .update(schema.panelInterviews)
    .set({ status: "reschedule_requested", candidateMessage: message.trim() || null, scheduledAt: null, sequence: iv.sequence + (iv.scheduledAt ? 1 : 0), updatedAt: new Date() })
    .where(eq(schema.panelInterviews.id, iv.id));
  await audit({ type: "candidate", id: candidacy.id }, "panel.reschedule_request", "candidacy", candidacy.id, { interviewId: iv.id });
}

async function staffInterview(user: StaffUser, interviewId: string) {
  const iv = await loadInterview(interviewId);
  if (!iv || iv.orgId !== user.orgId) throw new HttpError(404, "Interview not found");
  await accessibleCandidacy(user, iv.candidacyId);
  return iv;
}

/** Offer new times (after a reschedule request, or to move the interview). */
export async function rescheduleInterview(user: StaffUser, interviewId: string, slotsIn: string[]) {
  const iv = await staffInterview(user, interviewId);
  if (["cancelled", "completed"].includes(iv.status)) throw new HttpError(409, "This interview is closed.");
  const problem = slotProblem(slotsIn);
  if (problem) throw new HttpError(400, problem);
  const slots = slotsIn.map((s) => new Date(s).toISOString()).sort();
  const single = slots.length === 1;
  const [updated] = await db
    .update(schema.panelInterviews)
    .set({ slots, status: single ? "scheduled" : "proposed", scheduledAt: single ? new Date(slots[0]) : null, sequence: iv.sequence + 1, candidateMessage: null, updatedAt: new Date() })
    .where(eq(schema.panelInterviews.id, iv.id))
    .returning();
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "panel.reschedule", "candidacy", iv.candidacyId, { interviewId: iv.id, slots: slots.length });
  await notifyCandidate(updated, single ? "scheduled" : "choose");
  if (single) await onScheduled(updated);
  return updated;
}

export async function cancelInterview(user: StaffUser, interviewId: string, reason: string) {
  const iv = await staffInterview(user, interviewId);
  if (iv.status === "cancelled") return;
  const [updated] = await db.update(schema.panelInterviews).set({ status: "cancelled", sequence: iv.sequence + 1, updatedAt: new Date() }).where(eq(schema.panelInterviews.id, iv.id)).returning();
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "panel.cancel", "candidacy", iv.candidacyId, { interviewId: iv.id, reason });
  await notifyCandidate(updated, "cancelled");
}

/* ------------------------------- Scorecards ------------------------------- */

export interface ScorecardInput {
  ratings: Record<string, number | null>;
  recommendation: Recommendation;
  strengths?: string;
  concerns?: string;
}

async function decided(candidacyId: string, since: Date) {
  const [d] = await db
    .select({ id: schema.hiringDecisions.id })
    .from(schema.hiringDecisions)
    .where(and(eq(schema.hiringDecisions.candidacyId, candidacyId), ne(schema.hiringDecisions.decision, "hold"), sql`${schema.hiringDecisions.createdAt} > ${since}`));
  return !!d;
}

export async function submitScorecard(user: StaffUser, interviewId: string, input: ScorecardInput) {
  const iv = await loadInterview(interviewId);
  if (!iv || iv.orgId !== user.orgId) throw new HttpError(404, "Interview not found");
  const [card] = await db.select().from(schema.panelScorecards).where(and(eq(schema.panelScorecards.interviewId, iv.id), eq(schema.panelScorecards.panelistId, user.id)));
  if (!card) throw new HttpError(403, "Only panelists can submit a scorecard for this interview.");
  if (iv.status !== "scheduled" && iv.status !== "completed") throw new HttpError(409, "This interview isn't booked.");
  if (!iv.scheduledAt || iv.scheduledAt.getTime() > Date.now()) throw new HttpError(409, "Scorecards open when the interview starts.");
  if (await decided(iv.candidacyId, iv.createdAt)) throw new HttpError(409, "A final decision has been recorded; scorecards are locked.");
  const ratings: Record<string, number> = {};
  for (const [k, v] of Object.entries(input.ratings)) {
    if (!iv.competencies.includes(k)) throw new HttpError(400, `Unknown competency: ${k}`);
    if (v != null) ratings[k] = v;
  }
  if (!Object.keys(ratings).length) throw new HttpError(400, "Rate at least one competency.");
  await db
    .update(schema.panelScorecards)
    .set({ ratings, recommendation: input.recommendation, strengths: input.strengths?.trim() || null, concerns: input.concerns?.trim() || null, submittedAt: card.submittedAt ?? new Date(), updatedAt: new Date() })
    .where(eq(schema.panelScorecards.id, card.id));
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, card.submittedAt ? "panel.scorecard_update" : "panel.scorecard", "candidacy", iv.candidacyId, { interviewId: iv.id, recommendation: input.recommendation });
}

/* --------------------------- Views (visibility) --------------------------- */

/**
 * Other panelists' scorecards are hidden from a panelist until they submit their own (independent judgement);
 * people not on the panel see everything they can otherwise access.
 */
function canSeeOthers(user: StaffUser, cards: { panelistId: string; submittedAt: Date | null }[]) {
  const mine = cards.find((c) => c.panelistId === user.id);
  return !mine || !!mine.submittedAt;
}

export interface InterviewView {
  interview: PanelInterview;
  panel: { id: string; name: string; submitted: boolean; card: PanelScorecard | null }[];
  mine: PanelScorecard | null;
  othersHidden: boolean;
  summary: ReturnType<typeof summarisePanel> | null;
}

function viewOf(user: StaffUser, iv: PanelInterview, members: Awaited<ReturnType<typeof panelistsOf>>): InterviewView {
  const cards = members.map((m) => m.card);
  const others = canSeeOthers(user, cards);
  return {
    interview: iv,
    panel: members.map((m) => ({ id: m.id, name: m.name, submitted: !!m.card.submittedAt, card: m.id === user.id || others ? m.card : null })),
    mine: members.find((m) => m.id === user.id)?.card ?? null,
    othersHidden: !others,
    summary: others ? summarisePanel(iv.competencies, cards) : null,
  };
}

export async function panelForCandidacy(user: StaffUser, candidacyId: string) {
  const ivs = await db.select().from(schema.panelInterviews).where(eq(schema.panelInterviews.candidacyId, candidacyId)).orderBy(desc(schema.panelInterviews.createdAt));
  return Promise.all(ivs.map(async (iv) => viewOf(user, iv, await panelistsOf(iv.id))));
}

/** The interview kit: what a panelist needs, plus their scorecard. */
export async function interviewKit(user: StaffUser, interviewId: string) {
  const iv = await loadInterview(interviewId);
  if (!iv || iv.orgId !== user.orgId) throw new HttpError(404, "Interview not found");
  const members = await panelistsOf(iv.id);
  const isPanelist = members.some((m) => m.id === user.id);
  const row = await candidacyRow(iv.candidacyId);
  if (!row) throw new HttpError(404, "Interview not found");
  // Panelists can open their kit even if, as hiring managers, the drive was later unassigned from them.
  if (!isPanelist && (!canSeeDrive(user, row.d) || !hasRole(user, "hiring_manager"))) throw new HttpError(404, "Interview not found");
  const [combined] = await db.select().from(schema.combinedReports).where(eq(schema.combinedReports.candidacyId, iv.candidacyId));
  const reports = await db.select({ roundType: schema.roundReports.roundType, roundSpecific: schema.roundReports.roundSpecific, recommendation: schema.roundReports.recommendation, roundScore: schema.roundReports.roundScore }).from(schema.roundReports).where(and(eq(schema.roundReports.candidacyId, iv.candidacyId), eq(schema.roundReports.status, "ready"))).orderBy(asc(schema.roundReports.roundIndex));
  const cd = (combined?.data ?? {}) as { focusAreas?: string[]; risks?: string[]; executiveSummary?: string };
  const followUps = reports.flatMap((r) => ((r.roundSpecific as { followUpQuestions?: string[] } | null)?.followUpQuestions ?? []));
  const roundFocus = reports.flatMap((r) => ((r.roundSpecific as { focusAreas?: string[] } | null)?.focusAreas ?? []));
  return {
    ...viewOf(user, iv, members),
    isPanelist,
    candidate: { name: row.cand.name, candidacyId: row.c.id, driveTitle: row.d.title, stage: row.c.stage },
    ai: {
      recommendation: (combined?.status === "ready" ? combined.recommendation : null) as Recommendation | null,
      finalScore: combined?.status === "ready" ? combined.finalScore : null,
      summary: cd.executiveSummary ?? null,
      focusAreas: [...new Set([...(cd.focusAreas ?? []), ...roundFocus])].slice(0, 10),
      risks: cd.risks ?? [],
      candidateQuestions: [...new Set(followUps)].slice(0, 8),
    },
  };
}

/** Interviews the user sits on, upcoming first. */
export async function myInterviews(user: StaffUser) {
  return db
    .select({ iv: schema.panelInterviews, card: schema.panelScorecards, name: schema.candidates.name, driveTitle: schema.drives.title })
    .from(schema.panelScorecards)
    .innerJoin(schema.panelInterviews, eq(schema.panelScorecards.interviewId, schema.panelInterviews.id))
    .innerJoin(schema.candidacies, eq(schema.panelInterviews.candidacyId, schema.candidacies.id))
    .innerJoin(schema.candidates, eq(schema.candidacies.candidateId, schema.candidates.id))
    .innerJoin(schema.drives, eq(schema.candidacies.driveId, schema.drives.id))
    .where(and(eq(schema.panelScorecards.panelistId, user.id), eq(schema.panelInterviews.orgId, user.orgId), ne(schema.panelInterviews.status, "cancelled")))
    .orderBy(sql`${schema.panelInterviews.scheduledAt} desc nulls first`);
}

/** Interviews where the candidate asked for other times (recruiters act on these). */
export async function rescheduleRequests(user: StaffUser) {
  const rows = await db
    .select({ iv: schema.panelInterviews, name: schema.candidates.name, d: schema.drives })
    .from(schema.panelInterviews)
    .innerJoin(schema.candidacies, eq(schema.panelInterviews.candidacyId, schema.candidacies.id))
    .innerJoin(schema.candidates, eq(schema.candidacies.candidateId, schema.candidates.id))
    .innerJoin(schema.drives, eq(schema.candidacies.driveId, schema.drives.id))
    .where(and(eq(schema.panelInterviews.orgId, user.orgId), eq(schema.panelInterviews.status, "reschedule_requested")));
  return rows.filter((r) => canSeeDrive(user, r.d));
}

/** Panel options for the scheduling form: active staff who may sit on this drive's panel. */
export async function eligiblePanelists(orgId: string, driveId: string) {
  const users = await db.select({ id: schema.users.id, name: schema.users.name, role: schema.users.role, driveIds: schema.users.driveIds }).from(schema.users).where(and(eq(schema.users.orgId, orgId), eq(schema.users.active, true)));
  return users.filter((u) => PANEL_ROLES.includes(u.role as StaffRole) && (u.role !== "hiring_manager" || ((u.driveIds as string[] | null) ?? []).includes(driveId))).map(({ id, name, role }) => ({ id, name, role }));
}

/* ----------------------------- Final decision ----------------------------- */

export interface DecisionInput {
  decision: "offer" | "reject" | "hold";
  reason: string;
  notifyCandidate: boolean;
}

export async function recordDecision(user: StaffUser, candidacyId: string, input: DecisionInput) {
  const row = await accessibleCandidacy(user, candidacyId);
  if (!DECISION_STAGES.includes(row.c.stage)) throw new HttpError(409, "A final decision can be recorded once the AI rounds are finished.");
  const [combined] = await db.select().from(schema.combinedReports).where(eq(schema.combinedReports.candidacyId, candidacyId));
  const ivs = await db.select().from(schema.panelInterviews).where(and(eq(schema.panelInterviews.candidacyId, candidacyId), ne(schema.panelInterviews.status, "cancelled")));
  const panels = await Promise.all(ivs.map(async (iv) => ({ id: iv.id, title: iv.title, summary: summarisePanel(iv.competencies, (await panelistsOf(iv.id)).map((m) => m.card)) })));
  const basis = {
    ai: combined?.status === "ready" ? { recommendation: combined.recommendation, finalScore: combined.finalScore, partial: combined.partial } : null,
    panels: panels.map((p) => ({ id: p.id, title: p.title, consensus: p.summary.consensus, hireVotes: p.summary.hireVotes, submitted: p.summary.submitted, pending: p.summary.pending, split: p.summary.split })),
  };
  const stage = input.decision === "offer" ? "offer" : input.decision === "reject" ? "rejected" : "on_hold";
  const notify = input.notifyCandidate && input.decision !== "hold";
  const [d] = await db
    .insert(schema.hiringDecisions)
    .values({ orgId: user.orgId, candidacyId, decision: input.decision, reason: input.reason.trim(), basis, decidedBy: user.id, candidateNotifiedAt: notify ? new Date() : null })
    .returning();
  await db.update(schema.candidacies).set({ stage, finalStatus: stage, updatedAt: new Date() }).where(eq(schema.candidacies.id, candidacyId));
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, `decision.${input.decision}`, "candidacy", candidacyId, { notified: notify, panelSplit: panels.some((p) => p.summary.split), ai: basis.ai?.recommendation ?? null });
  await emitEvent(user.orgId, "candidate.decided", { candidacyId, decision: input.decision, aiRecommendation: basis.ai?.recommendation ?? null, panelConsensus: panels[0]?.summary.consensus ?? null });
  if (notify) {
    const s = await getSettings(user.orgId);
    const body =
      input.decision === "offer"
        ? `<p>Thank you for interviewing for <b>${esc(row.d.title)}</b>. We're delighted to tell you that ${esc(s.companyName)} would like to make you an offer. A member of the team will contact you shortly with the details.</p>`
        : `<p>Thank you for the time and effort you put into interviewing for <b>${esc(row.d.title)}</b> at ${esc(s.companyName)}. After careful consideration, we won't be moving forward with your application this time. We appreciate your interest and wish you every success.</p>`;
    await sendEmail(row.cand.email, `Your application for ${row.d.title}`, `<p>Hi ${esc(row.cand.name)},</p>${body}`).catch((e) => console.error("decision email failed", e));
  }
  return d;
}

export async function decisionsFor(candidacyId: string) {
  return db
    .select({ d: schema.hiringDecisions, by: schema.users.name })
    .from(schema.hiringDecisions)
    .leftJoin(schema.users, eq(schema.hiringDecisions.decidedBy, schema.users.id))
    .where(eq(schema.hiringDecisions.candidacyId, candidacyId))
    .orderBy(desc(schema.hiringDecisions.createdAt));
}

/** What the candidate is told on their page: only decisions the team chose to send. */
export async function candidateOutcome(candidacyId: string) {
  const [d] = await db
    .select({ decision: schema.hiringDecisions.decision, at: schema.hiringDecisions.candidateNotifiedAt })
    .from(schema.hiringDecisions)
    .where(eq(schema.hiringDecisions.candidacyId, candidacyId))
    .orderBy(desc(schema.hiringDecisions.createdAt))
    .limit(1);
  return d?.at ? d.decision : null;
}

/** Candidate view of their panel interviews (no panel names, no scorecards). */
export async function candidateInterviews(candidacyId: string) {
  return db
    .select({ id: schema.panelInterviews.id, title: schema.panelInterviews.title, durationMin: schema.panelInterviews.durationMin, location: schema.panelInterviews.location, slots: schema.panelInterviews.slots, scheduledAt: schema.panelInterviews.scheduledAt, status: schema.panelInterviews.status })
    .from(schema.panelInterviews)
    .where(and(eq(schema.panelInterviews.candidacyId, candidacyId), ne(schema.panelInterviews.status, "cancelled")))
    .orderBy(desc(schema.panelInterviews.createdAt));
}

/* -------------------------------- Reminders ------------------------------- */

/** Panelists who haven't submitted 24 hours after the interview ended get one reminder. */
export async function sendScorecardReminders(now = new Date()) {
  const due = await db
    .select({ card: schema.panelScorecards, iv: schema.panelInterviews, email: schema.users.email, name: schema.users.name })
    .from(schema.panelScorecards)
    .innerJoin(schema.panelInterviews, eq(schema.panelScorecards.interviewId, schema.panelInterviews.id))
    .innerJoin(schema.users, eq(schema.panelScorecards.panelistId, schema.users.id))
    .where(
      and(
        isNull(schema.panelScorecards.submittedAt),
        isNull(schema.panelScorecards.remindedAt),
        eq(schema.panelInterviews.status, "scheduled"),
        lt(sql`${schema.panelInterviews.scheduledAt} + (${schema.panelInterviews.durationMin} * interval '1 minute') + interval '24 hours'`, now),
      ),
    )
    .limit(100);
  for (const r of due) {
    await db.update(schema.panelScorecards).set({ remindedAt: now }).where(eq(schema.panelScorecards.id, r.card.id));
    await sendEmail(r.email, `Scorecard reminder: ${r.iv.title}`, `<p>Hi ${esc(r.name)},</p><p>Your scorecard for the ${esc(r.iv.title)} on ${fmtUtc(r.iv.scheduledAt!)} is still open. <a href="${env.appBaseUrl.replace(/\/$/, "")}/app/panel/${r.iv.id}">Submit it now</a> while it's fresh.</p>`).catch((e) => console.error("reminder failed", e));
  }
  return due.length;
}

