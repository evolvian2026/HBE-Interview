import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { HttpError, type StaffUser } from "../auth/staff";
import { newAccessToken } from "../auth/candidate";
import { enabledRounds } from "../core/rounds";
import type { DriveConfig, RoundType } from "../core/types";
import { ROUND_LABEL } from "../core/types";
import { audit } from "../audit";
import { candidateLink, sendInviteEmail } from "./notify";
import { emitEvent } from "./integrations";

const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

async function upsertCandidate(orgId: string, name: string, email: string) {
  const [c] = await db
    .insert(schema.candidates)
    .values({ orgId, name: name.trim(), email: email.trim().toLowerCase() })
    .onConflictDoUpdate({ target: [schema.candidates.orgId, schema.candidates.email], set: { name: name.trim() } })
    .returning();
  return c;
}

export type CandidacySource = "invite" | "csv" | "open" | "api" | "reinvite";

export async function createCandidacy(drive: typeof schema.drives.$inferSelect, name: string, email: string, source: CandidacySource) {
  if (!drive.currentVersionId) throw new HttpError(400, "This drive is not published yet.");
  const [version] = await db.select().from(schema.driveVersions).where(eq(schema.driveVersions.id, drive.currentVersionId));
  const config = version.config as DriveConfig;
  const candidate = await upsertCandidate(drive.orgId, name, email);
  const [existing] = await db
    .select()
    .from(schema.candidacies)
    .where(and(eq(schema.candidacies.driveId, drive.id), eq(schema.candidacies.candidateId, candidate.id)));
  if (existing) return { candidacy: existing, created: false };
  const [candidacy] = await db
    .insert(schema.candidacies)
    .values({
      orgId: drive.orgId,
      driveId: drive.id,
      driveVersionId: version.id,
      candidateId: candidate.id,
      accessToken: newAccessToken(),
      source,
      expiresAt: new Date(Date.now() + config.inviteExpiryDays * 86_400_000),
    })
    .returning();
  await emitEvent(drive.orgId, "candidate.invited", { candidacyId: candidacy.id, driveId: drive.id, candidate: { name: candidate.name, email: candidate.email } });
  return { candidacy, created: true };
}

/** Invite candidates to a drive of the actor's organisation (staff user or API key). */
export async function inviteCandidates(driveId: string, list: { name: string; email: string }[], actor: { id: string | null; orgId: string }, via: "ui" | "api" = "ui", source: "invite" | "csv" = "invite") {
  const [drive] = await db.select().from(schema.drives).where(and(eq(schema.drives.id, driveId), eq(schema.drives.orgId, actor.orgId)));
  if (!drive) throw new HttpError(404, "Drive not found");
  if (drive.status !== "active") throw new HttpError(400, "Publish (activate) the drive before inviting candidates.");
  const out: { name: string; email: string; link?: string; status: string }[] = [];
  const ids: (string | undefined)[] = [];
  for (const item of list.slice(0, 200)) {
    if (!item.name?.trim() || !emailOk(item.email ?? "")) {
      out.push({ ...item, status: "invalid" });
      ids.push(undefined);
      continue;
    }
    const { candidacy, created } = await createCandidacy(drive, item.name, item.email, via === "api" ? "api" : source);
    if (created) await sendInviteEmail(candidacy.id).catch((e) => console.error("invite email failed", e));
    ids.push(candidacy.id);
    out.push({ name: item.name, email: item.email, link: candidateLink(candidacy.accessToken), status: created ? "invited" : "already_invited" });
  }
  await audit({ type: "staff", id: actor.id, orgId: actor.orgId }, "drive.invite", "drive", driveId, { count: out.length, via });
  return out.map((o, i) => ({ ...o, candidacyId: ids[i] }));
}

export async function registerOpen(openSlug: string, name: string, email: string) {
  const [drive] = await db.select().from(schema.drives).where(eq(schema.drives.openSlug, openSlug));
  if (!drive || drive.status !== "active") throw new HttpError(404, "This interview link is not active.");
  if (!name.trim() || !emailOk(email)) throw new HttpError(400, "Please enter your name and a valid email.");
  const { candidacy, created } = await createCandidacy(drive, name, email, "open");
  if (!created) {
    // Never hand out an existing candidacy's link to whoever types the email — resend it to the inbox instead.
    await sendInviteEmail(candidacy.id).catch(() => undefined);
    throw new HttpError(409, "You've already registered for this interview. We've re-sent your personal link to your email; if you don't receive it, contact the recruiter.");
  }
  await sendInviteEmail(candidacy.id).catch(() => undefined);
  await audit({ type: "candidate", id: candidacy.id }, "candidacy.register", "candidacy", candidacy.id);
  return candidacy;
}

export async function recordConsent(candidacyId: string, accept: boolean, text: string, version: number, meta: { ip?: string | null; ua?: string | null; webcam?: boolean }) {
  await db
    .update(schema.candidacies)
    .set({
      stage: accept ? "onboarding" : "declined",
      consent: { accepted: accept, version, textHash: text.length, at: new Date().toISOString(), ip: meta.ip ?? null, ua: meta.ua ?? null, webcam: !!meta.webcam },
      updatedAt: new Date(),
    })
    .where(eq(schema.candidacies.id, candidacyId));
  await audit({ type: "candidate", id: candidacyId }, accept ? "consent.accept" : "consent.decline", "candidacy", candidacyId, { version });
}

export function needsProjectsStep(config: DriveConfig) {
  const tech = enabledRounds(config).find((r) => r.type === "technical");
  return !!tech?.sections.some((s) => s.enabled && s.key === "github");
}

export interface CandidateRoundView {
  index: number;
  type: RoundType;
  label: string;
  durationMin: number;
  sections: string[];
  status: "completed" | "in_progress" | "available" | "under_review" | "locked" | "expired";
  sessionId?: string;
}

export async function candidateRounds(candidacy: typeof schema.candidacies.$inferSelect, config: DriveConfig): Promise<CandidateRoundView[]> {
  const sessions = await db.select().from(schema.roundSessions).where(eq(schema.roundSessions.candidacyId, candidacy.id)).orderBy(asc(schema.roundSessions.roundIndex));
  // The round awaiting review is the next one once the current round has ended; if the candidate was put on
  // hold after being advanced (current round not yet taken), it is the current round itself.
  const currentDone = sessions.some((x) => x.roundIndex === candidacy.currentRoundIndex && x.status === "ended");
  const reviewIndex = currentDone ? candidacy.currentRoundIndex + 1 : candidacy.currentRoundIndex;
  return enabledRounds(config).map((r, i) => {
    const s = sessions.find((x) => x.roundIndex === i);
    let status: CandidateRoundView["status"] = "locked";
    if (s?.status === "ended") status = "completed";
    else if (s) status = "in_progress";
    else if (i === candidacy.currentRoundIndex && ["ready", "round_available"].includes(candidacy.stage)) status = "available";
    else if (i === candidacy.currentRoundIndex && candidacy.stage === "expired") status = "expired";
    else if (i === reviewIndex && ["evaluating", "gate_pending", "on_hold"].includes(candidacy.stage)) status = "under_review";
    return {
      index: i,
      type: r.type,
      label: ROUND_LABEL[r.type],
      durationMin: r.durationMin,
      sections: r.sections.filter((x) => x.enabled).map((x) => x.title),
      status,
      sessionId: s?.id,
    };
  });
}
