import { and, asc, eq, inArray, lt } from "drizzle-orm";
import { db, schema } from "../db";
import { HttpError } from "../auth/staff";
import { audit } from "../audit";
import { purgeCandidacy } from "./maintenance";
import { sendEmail } from "./notify";
import { getSettings } from "../settings";

/** Statutory-style deadline for erasure requests (GDPR: one month; DPDP: reasonable period). */
export const DELETION_DUE_DAYS = 30;

/**
 * Everything the candidate gave us or said, as JSON: profile, resume text and parsed profile, consent record,
 * repositories, interview transcripts, written responses, code they ran/submitted, practical details, survey answers
 * and any feedback released to them. Internal evaluations (scores, recruiter notes) are not included — the hiring
 * organisation provides those on request.
 */
export async function exportCandidateData(candidacyId: string) {
  const [row] = await db
    .select({ c: schema.candidacies, cand: schema.candidates, drive: schema.drives.title, org: schema.organizations.name })
    .from(schema.candidacies)
    .innerJoin(schema.candidates, eq(schema.candidacies.candidateId, schema.candidates.id))
    .innerJoin(schema.drives, eq(schema.candidacies.driveId, schema.drives.id))
    .innerJoin(schema.organizations, eq(schema.candidacies.orgId, schema.organizations.id))
    .where(eq(schema.candidacies.id, candidacyId));
  if (!row) throw new HttpError(404, "Not found");
  const [resume] = await db
    .select({ fileName: schema.resumes.fileName, uploadedText: schema.resumes.rawText, parsedProfile: schema.resumes.parsed })
    .from(schema.resumes)
    .where(eq(schema.resumes.candidacyId, candidacyId));
  const repos = await db.select({ url: schema.repositories.url, projectName: schema.repositories.projectName }).from(schema.repositories).where(eq(schema.repositories.candidacyId, candidacyId));
  const sessions = await db.select().from(schema.roundSessions).where(eq(schema.roundSessions.candidacyId, candidacyId)).orderBy(asc(schema.roundSessions.roundIndex));
  const sids = sessions.map((s) => s.id);
  const msgs = sids.length
    ? await db.select().from(schema.messages).where(and(inArray(schema.messages.sessionId, sids), inArray(schema.messages.role, ["ai", "candidate"]))).orderBy(asc(schema.messages.seq))
    : [];
  const written = sids.length ? await db.select({ sessionId: schema.exerciseResponses.sessionId, kind: schema.exerciseResponses.kind, content: schema.exerciseResponses.content, whiteboard: schema.exerciseResponses.whiteboard }).from(schema.exerciseResponses).where(inArray(schema.exerciseResponses.sessionId, sids)) : [];
  const code = sids.length ? await db.select({ sessionId: schema.codeRuns.sessionId, kind: schema.codeRuns.kind, language: schema.codeRuns.language, code: schema.codeRuns.code, createdAt: schema.codeRuns.createdAt }).from(schema.codeRuns).where(and(inArray(schema.codeRuns.sessionId, sids), inArray(schema.codeRuns.kind, ["run", "submit"]))).orderBy(asc(schema.codeRuns.createdAt)) : [];
  const [fit] = await db.select({ data: schema.practicalFit.data }).from(schema.practicalFit).where(eq(schema.practicalFit.candidacyId, candidacyId));
  const survey = await db.select({ roundIndex: schema.candidateFeedback.roundIndex, overall: schema.candidateFeedback.overall, fairness: schema.candidateFeedback.fairness, clarity: schema.candidateFeedback.clarity, technical: schema.candidateFeedback.technical, comment: schema.candidateFeedback.comment }).from(schema.candidateFeedback).where(eq(schema.candidateFeedback.candidacyId, candidacyId));
  return {
    exportedAt: new Date().toISOString(),
    organisation: row.org,
    role: row.drive,
    you: { name: row.cand.name, email: row.cand.email, githubUsername: row.cand.githubUsername },
    application: { stage: row.c.stage, invitedAt: row.c.createdAt, consent: row.c.consent },
    resume: resume ?? null,
    repositories: repos,
    rounds: sessions.map((s) => ({
      roundIndex: s.roundIndex,
      roundType: s.roundType,
      mode: s.mode,
      language: s.language,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      transcript: msgs.filter((m) => m.sessionId === s.id).map((m) => ({ from: m.role === "ai" ? "interviewer" : "you", at: m.createdAt, text: m.content })),
      writtenResponses: written.filter((w) => w.sessionId === s.id).map(({ kind, content, whiteboard }) => ({ kind, content, whiteboard })),
      code: code.filter((c) => c.sessionId === s.id).map(({ kind, language, code: src, createdAt }) => ({ kind, language, code: src, at: createdAt })),
    })),
    practicalDetails: fit?.data ?? null,
    surveyAnswers: survey,
    feedbackReleasedToYou: row.c.feedbackReleasedAt ? row.c.feedbackSummary : null,
    note: "This file contains the personal data you provided and your interview record. Internal evaluations (scores and recruiter notes) are available from the hiring organisation on request.",
  };
}

export async function pendingDeletion(candidacyId: string) {
  const [r] = await db
    .select()
    .from(schema.dataRequests)
    .where(and(eq(schema.dataRequests.candidacyId, candidacyId), eq(schema.dataRequests.type, "deletion"), eq(schema.dataRequests.status, "pending")));
  return r ?? null;
}

export async function requestDeletion(candidacy: typeof schema.candidacies.$inferSelect, email: string, reason: string | null) {
  const existing = await pendingDeletion(candidacy.id);
  if (existing) return existing;
  const [r] = await db
    .insert(schema.dataRequests)
    .values({ orgId: candidacy.orgId, candidacyId: candidacy.id, candidateEmail: email, type: "deletion", reason, dueAt: new Date(Date.now() + DELETION_DUE_DAYS * 86_400_000) })
    .returning();
  await audit({ type: "candidate", id: candidacy.id, orgId: candidacy.orgId }, "data.deletion_requested", "candidacy", candidacy.id, { requestId: r.id });
  return r;
}

/** Delete the candidate's data now and close the request (staff action, or automatically at the due date). */
export async function fulfilDeletion(requestId: string, actor: { type: "staff" | "system"; id?: string; orgId: string }) {
  const [r] = await db.select().from(schema.dataRequests).where(and(eq(schema.dataRequests.id, requestId), eq(schema.dataRequests.orgId, actor.orgId)));
  if (!r) throw new HttpError(404, "Request not found");
  if (r.status !== "pending") throw new HttpError(409, "This request is already closed");
  const org = (await getSettings(r.orgId)).companyName;
  if (r.candidacyId) await purgeCandidacy(r.candidacyId, "data_subject_request", { type: actor.type, id: actor.id, orgId: actor.orgId });
  await db
    .update(schema.dataRequests)
    .set({ status: "completed", resolvedAt: new Date(), resolvedBy: actor.type === "staff" ? (actor.id ?? null) : null, resolution: actor.type === "system" ? "Deleted automatically at the due date" : "Deleted" })
    .where(eq(schema.dataRequests.id, r.id));
  await audit(actor, "data.deletion_completed", "data_request", r.id, { candidacyId: r.candidacyId });
  await sendEmail(r.candidateEmail, `Your data has been deleted — ${org}`, `<p>As you requested, ${org} has deleted the personal data from your interview (resume, interview record and assessments).</p><p>A minimal record that the request was received and completed is kept as proof of compliance.</p>`).catch(() => undefined);
}

export async function declineDeletion(requestId: string, reason: string, actor: { id: string; orgId: string }) {
  const [r] = await db.select().from(schema.dataRequests).where(and(eq(schema.dataRequests.id, requestId), eq(schema.dataRequests.orgId, actor.orgId)));
  if (!r) throw new HttpError(404, "Request not found");
  if (r.status !== "pending") throw new HttpError(409, "This request is already closed");
  await db.update(schema.dataRequests).set({ status: "rejected", resolvedAt: new Date(), resolvedBy: actor.id, resolution: reason }).where(eq(schema.dataRequests.id, r.id));
  await audit({ type: "staff", id: actor.id, orgId: actor.orgId }, "data.deletion_declined", "data_request", r.id, { candidacyId: r.candidacyId, reason });
  const org = (await getSettings(r.orgId)).companyName;
  await sendEmail(r.candidateEmail, `About your data deletion request — ${org}`, `<p>${org} has not deleted your interview data at this time, for the following reason:</p><blockquote>${reason.replace(/[<>&]/g, "")}</blockquote><p>You can reply to the hiring team or contact your data-protection authority if you disagree.</p>`).catch(() => undefined);
}

/** Maintenance: fulfil pending deletion requests that reached their due date. */
export async function fulfilOverdueDeletions() {
  const due = await db.select({ id: schema.dataRequests.id, orgId: schema.dataRequests.orgId }).from(schema.dataRequests).where(and(eq(schema.dataRequests.status, "pending"), lt(schema.dataRequests.dueAt, new Date())));
  for (const r of due) await fulfilDeletion(r.id, { type: "system", orgId: r.orgId }).catch((e) => console.error("auto deletion failed", r.id, e));
  return due.length;
}
