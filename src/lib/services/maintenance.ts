import { and, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { getSettings } from "../settings";
import { endSession } from "../interview/orchestrator";
import { audit } from "../audit";
import { sendReminderEmail } from "./notify";
import { sendScorecardReminders } from "./panel";

let lastPurge = 0;

/** Periodic housekeeping: finalise abandoned/overdue sessions, expire invitations, purge data past retention. */
export async function periodicMaintenance() {
  const now = new Date();
  // 1) Active sessions with no heartbeat beyond the reconnect window, or well past their deadline.
  const active = await db.select().from(schema.roundSessions).where(eq(schema.roundSessions.status, "active"));
  for (const s of active) {
    const hb = s.lastHeartbeatAt?.getTime() ?? s.startedAt?.getTime() ?? now.getTime();
    const overdue = s.deadlineAt && now.getTime() > s.deadlineAt.getTime() + 5 * 60_000;
    const abandoned = now.getTime() - hb > 15 * 60_000;
    if (overdue || abandoned) {
      await endSession(s.id, overdue ? "time_up" : "incomplete_disconnect").catch((e) => console.error("endSession failed", e));
    }
  }
  // 2) Expire invitations that were never started.
  await db
    .update(schema.candidacies)
    .set({ stage: "expired", updatedAt: now })
    .where(and(eq(schema.candidacies.stage, "invited"), lt(schema.candidacies.expiresAt, now)));
  // 3) Expire next-round availability windows.
  await db
    .update(schema.candidacies)
    .set({ stage: "expired", updatedAt: now })
    .where(and(eq(schema.candidacies.stage, "round_available"), lt(schema.candidacies.roundAvailableUntil, now)));
  // 4) Reminders 48h before an invitation or next-round window expires (once per window).
  const soon = new Date(now.getTime() + 48 * 3600_000);
  const due = await db
    .select({ id: schema.candidacies.id })
    .from(schema.candidacies)
    .where(
      and(
        isNull(schema.candidacies.reminderSentAt),
        or(
          and(inArray(schema.candidacies.stage, ["invited", "onboarding", "ready"]), gt(schema.candidacies.expiresAt, now), lt(schema.candidacies.expiresAt, soon)),
          and(eq(schema.candidacies.stage, "round_available"), gt(schema.candidacies.roundAvailableUntil, now), lt(schema.candidacies.roundAvailableUntil, soon)),
        ),
      ),
    )
    .limit(50);
  for (const c of due) {
    await db.update(schema.candidacies).set({ reminderSentAt: now }).where(eq(schema.candidacies.id, c.id));
    await sendReminderEmail(c.id).catch((e) => console.error("reminder failed", e));
  }
  // 5) Panel scorecards still open a day after the interview.
  await sendScorecardReminders(now).catch((e) => console.error("scorecard reminders failed", e));
  // 6) Retention purge (daily).
  if (now.getTime() - lastPurge > 24 * 3600_000) {
    lastPurge = now.getTime();
    // Each organisation has its own retention period.
    for (const org of await db.select({ id: schema.organizations.id }).from(schema.organizations)) {
      const settings = await getSettings(org.id);
      const cutoff = new Date(now.getTime() - settings.retentionDays * 86_400_000);
      const old = await db
        .select({ id: schema.candidacies.id })
        .from(schema.candidacies)
        .where(
          and(eq(schema.candidacies.orgId, org.id), lt(schema.candidacies.updatedAt, cutoff), sql`${schema.candidacies.stage} in ('completed','rejected','expired','declined','shortlisted','offer')`),
        );
      for (const c of old) await purgeCandidacy(c.id, "retention");
    }
    const { pruneJobs } = await import("./ops");
    await pruneJobs();
    // Candidate deletion requests not actioned or declined by their due date are fulfilled automatically.
    const { fulfilOverdueDeletions } = await import("./data-rights");
    await fulfilOverdueDeletions();
    // Webhook payloads carry candidate names/emails — keep delivery history for 30 days only.
    await db.delete(schema.webhookDeliveries).where(lt(schema.webhookDeliveries.createdAt, new Date(now.getTime() - 30 * 86_400_000)));
  }
}

/** Delete a candidacy's personal data (resume, transcripts, code, reports), leaving an anonymised audit stub. */
export async function purgeCandidacy(candidacyId: string, reason: string, actor: { type: "staff" | "system"; id?: string; orgId?: string } = { type: "system" }) {
  const [c] = await db.select().from(schema.candidacies).where(eq(schema.candidacies.id, candidacyId));
  if (!c) return;
  await db.delete(schema.candidacies).where(eq(schema.candidacies.id, candidacyId));
  // Remove the candidate record if they have no other candidacies.
  const others = await db.select({ id: schema.candidacies.id }).from(schema.candidacies).where(eq(schema.candidacies.candidateId, c.candidateId)).limit(1);
  if (!others.length) await db.delete(schema.candidates).where(eq(schema.candidates.id, c.candidateId));
  await audit({ ...actor, orgId: c.orgId }, "candidacy.purge", "candidacy", candidacyId, { driveId: c.driveId, reason, createdAt: c.createdAt });
}
