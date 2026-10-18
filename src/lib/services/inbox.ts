import { and, asc, eq, inArray, isNull, ne, notExists, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { canSeeDrive, hasRole, type StaffRole, type StaffUser } from "../auth/staff";
import { calibrationQueue, calibrationStats } from "./calibration";
import { pendingAccommodations } from "./accommodations";
import { rescheduleRequests } from "./panel";

export interface InboxItem {
  label: string;
  sub?: string;
  href: string;
  /** ISO time the item became due or is scheduled for. */
  at?: string;
}

export interface InboxSection {
  key: string;
  title: string;
  /** Sections that need someone to act count towards the badge; "info" ones don't. */
  kind: "action" | "info";
  count: number;
  items: InboxItem[];
  empty?: string;
  more?: { href: string; label: string };
}

const MAX = 8;

/** Everything waiting on this person, by what they can do about it. */
export async function inbox(user: StaffUser, opts: { light?: boolean } = {}): Promise<InboxSection[]> {
  const now = new Date();
  const sections: InboxSection[] = [];

  // Panel scorecards due and upcoming interviews (anyone who sits on panels).
  if (hasRole(user, "hiring_manager")) {
    const mine = await db
      .select({ iv: schema.panelInterviews, card: schema.panelScorecards, name: schema.candidates.name, drive: schema.drives.title })
      .from(schema.panelScorecards)
      .innerJoin(schema.panelInterviews, eq(schema.panelScorecards.interviewId, schema.panelInterviews.id))
      .innerJoin(schema.candidacies, eq(schema.panelInterviews.candidacyId, schema.candidacies.id))
      .innerJoin(schema.candidates, eq(schema.candidacies.candidateId, schema.candidates.id))
      .innerJoin(schema.drives, eq(schema.candidacies.driveId, schema.drives.id))
      .where(and(eq(schema.panelScorecards.panelistId, user.id), eq(schema.panelInterviews.orgId, user.orgId), eq(schema.panelInterviews.status, "scheduled")))
      .orderBy(asc(schema.panelInterviews.scheduledAt));
    const decided = await finalDecisionSet(mine.map((m) => m.iv.candidacyId));
    const due = mine.filter((m) => !m.card.submittedAt && m.iv.scheduledAt && m.iv.scheduledAt <= now && !decided.has(m.iv.candidacyId));
    sections.push({
      key: "scorecards",
      title: "Your scorecards to submit",
      kind: "action",
      count: due.length,
      items: due.slice(0, MAX).map((m) => ({ label: m.name, sub: `${m.drive} · ${m.iv.title}`, href: `/app/panel/${m.iv.id}`, at: m.iv.scheduledAt!.toISOString() })),
      empty: "No scorecards waiting.",
      more: { href: "/app/panel", label: "All your interviews" },
    });
    const week = new Date(now.getTime() + 7 * 86_400_000);
    const upcoming = mine.filter((m) => m.iv.scheduledAt && m.iv.scheduledAt > now && m.iv.scheduledAt < week);
    sections.push({
      key: "upcoming",
      title: "Your panel interviews this week",
      kind: "info",
      count: upcoming.length,
      items: upcoming.slice(0, MAX).map((m) => ({ label: m.name, sub: `${m.drive} · ${m.iv.title}`, href: `/app/panel/${m.iv.id}`, at: m.iv.scheduledAt!.toISOString() })),
      empty: "Nothing in the next 7 days.",
    });

    // Gate decisions between rounds.
    const gates = (
      await db
        .select({ c: schema.candidacies, name: schema.candidates.name, d: schema.drives })
        .from(schema.candidacies)
        .innerJoin(schema.candidates, eq(schema.candidacies.candidateId, schema.candidates.id))
        .innerJoin(schema.drives, eq(schema.candidacies.driveId, schema.drives.id))
        .where(and(eq(schema.candidacies.orgId, user.orgId), eq(schema.candidacies.stage, "gate_pending")))
        .orderBy(asc(schema.candidacies.updatedAt))
    ).filter((r) => canSeeDrive(user, r.d));
    sections.push({
      key: "gates",
      title: "Round decisions waiting",
      kind: "action",
      count: gates.length,
      items: gates.slice(0, MAX).map((r) => ({ label: r.name, sub: `${r.d.title} · after round ${r.c.currentRoundIndex + 1}`, href: `/app/candidates/${r.c.id}`, at: r.c.updatedAt.toISOString() })),
      empty: "No round decisions waiting.",
      more: { href: "/app/gate-queue", label: "All decisions" },
    });

    // Panels whose scorecards are all in, waiting for the final call.
    const panelDone = (
      await db
        .select({ c: schema.candidacies, name: schema.candidates.name, d: schema.drives })
        .from(schema.candidacies)
        .innerJoin(schema.candidates, eq(schema.candidacies.candidateId, schema.candidates.id))
        .innerJoin(schema.drives, eq(schema.candidacies.driveId, schema.drives.id))
        .where(
          and(
            eq(schema.candidacies.orgId, user.orgId),
            eq(schema.candidacies.stage, "panel"),
            // Every scorecard of every live interview is in.
            notExists(
              db
                .select({ x: sql`1` })
                .from(schema.panelScorecards)
                .innerJoin(schema.panelInterviews, eq(schema.panelScorecards.interviewId, schema.panelInterviews.id))
                .where(and(eq(schema.panelInterviews.candidacyId, schema.candidacies.id), ne(schema.panelInterviews.status, "cancelled"), isNull(schema.panelScorecards.submittedAt))),
            ),
            sql`exists (select 1 from panel_interviews p where p.candidacy_id = ${schema.candidacies.id} and p.status = 'scheduled' and p.scheduled_at < now())`,
          ),
        )
        .orderBy(asc(schema.candidacies.updatedAt))
    ).filter((r) => canSeeDrive(user, r.d));
    sections.push({
      key: "final",
      title: "Panel feedback complete — ready for a final decision",
      kind: "action",
      count: panelDone.length,
      items: panelDone.slice(0, MAX).map((r) => ({ label: r.name, sub: r.d.title, href: `/app/candidates/${r.c.id}` })),
      empty: "No completed panels waiting.",
      more: { href: "/app/gate-queue", label: "Decisions" },
    });

    const queue = opts.light ? [] : await calibrationQueue(user);
    sections.push({
      key: "calibration",
      title: "Blind calibration reviews",
      kind: "info",
      count: queue.length,
      items: queue.slice(0, MAX).map((q) => ({ label: q.driveTitle, sub: `Round ${q.roundIndex + 1} · ${q.reason === "low_confidence" ? "low AI confidence" : q.reason === "requested" ? "requested" : "random sample"}`, href: `/app/calibration/${q.reportId}` })),
      empty: "Nothing to review.",
      more: { href: "/app/calibration", label: "All reviews" },
    });
  }

  if (hasRole(user, "recruiter")) {
    const adj = (await pendingAccommodations(user.orgId)).filter((x) => canSeeDrive(user, { id: x.driveId, orgId: user.orgId }));
    sections.push({
      key: "adjustments",
      title: "Interview adjustment requests",
      kind: "action",
      count: adj.length,
      items: adj.slice(0, MAX).map((x) => ({ label: x.name, sub: x.driveTitle, href: `/app/candidates/${x.a.candidacyId}#adjustments`, at: x.a.createdAt.toISOString() })),
      empty: "No requests.",
      more: { href: "/app/gate-queue", label: "All adjustment requests" },
    });
    const rs = await rescheduleRequests(user);
    sections.push({
      key: "reschedules",
      title: "Panel interviews to reschedule",
      kind: "action",
      count: rs.length,
      more: { href: "/app/gate-queue", label: "All reschedule requests" },
      items: rs.slice(0, MAX).map((x) => ({ label: x.name, sub: `${x.d.title}${x.iv.candidateMessage ? ` · “${x.iv.candidateMessage.slice(0, 80)}”` : ""}`, href: `/app/candidates/${x.iv.candidacyId}` })),
      empty: "No requests.",
    });
    const drift = opts.light ? { alerts: [] as string[] } : await calibrationStats(user, { days: 90 });
    if (drift.alerts.length)
      sections.push({ key: "drift", title: "AI scoring drift", kind: "info", count: drift.alerts.length, items: drift.alerts.slice(0, MAX).map((a) => ({ label: a, href: "/app/calibration" })) });
  }

  if (user.role === "admin") {
    const reqs = await db
      .select({ r: schema.dataRequests })
      .from(schema.dataRequests)
      .where(and(eq(schema.dataRequests.orgId, user.orgId), eq(schema.dataRequests.status, "pending")))
      .orderBy(asc(schema.dataRequests.dueAt));
    sections.push({
      key: "data",
      title: "Candidate data deletion requests",
      kind: "action",
      count: reqs.length,
      items: reqs.slice(0, MAX).map(({ r }) => ({ label: r.candidateEmail, sub: `due ${r.dueAt.toLocaleDateString()}`, href: "/app/data-requests", at: r.dueAt.toISOString() })),
      empty: "No requests.",
      more: { href: "/app/data-requests", label: "Data requests" },
    });
  }
  return sections;
}

async function finalDecisionSet(candidacyIds: string[]) {
  if (!candidacyIds.length) return new Set<string>();
  const rows = await db
    .select({ id: schema.hiringDecisions.candidacyId })
    .from(schema.hiringDecisions)
    .where(and(inArray(schema.hiringDecisions.candidacyId, candidacyIds), ne(schema.hiringDecisions.decision, "hold")));
  return new Set(rows.map((r) => r.id));
}

export const actionCount = (sections: InboxSection[]) => sections.filter((s) => s.kind === "action").reduce((n, s) => n + s.count, 0);

/* --------------------------------- Digest --------------------------------- */

/** A StaffUser view of a user row, acting in their own organisation (for background jobs). */
export function staffFromRow(u: typeof schema.users.$inferSelect): StaffUser {
  return { id: u.id, email: u.email, name: u.name, role: u.role as StaffRole, driveIds: u.driveIds ?? [], orgId: u.orgId, homeOrgId: u.orgId, platformAdmin: u.platformAdmin, mustEnroll2fa: false, has2fa: !!u.totpEnabledAt, sessionVersion: u.sessionVersion, viaSso: false };
}

/** Users who asked for the daily digest and haven't had one in the last 20 hours (sent from 07:00 UTC). */
export async function dueDigestUsers(now = new Date()) {
  if (now.getUTCHours() < 7) return [];
  return db
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.digestOptIn, true), eq(schema.users.active, true), sql`(${schema.users.digestSentAt} is null or ${schema.users.digestSentAt} < ${new Date(now.getTime() - 20 * 3600_000)})`))
    .limit(200);
}


/** Send the daily digest to opted-in staff who have something to act on (called from the maintenance loop). */
export async function sendDigests(now = new Date()) {
  const { sendEmail } = await import("./notify");
  const { env } = await import("../env");
  const base = env.appBaseUrl.replace(/\/$/, "");
  const esc = (x: string) => x.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
  let sent = 0;
  for (const u of await dueDigestUsers(now)) {
    // Mark first so a slow or failing send never produces duplicates.
    await db.update(schema.users).set({ digestSentAt: now }).where(eq(schema.users.id, u.id));
    const sections = (await inbox(staffFromRow(u))).filter((s) => s.count > 0);
    if (!actionCount(sections)) continue;
    const html = sections
      .map((s) => `<h3 style="margin:16px 0 4px">${esc(s.title)} (${s.count})</h3><ul>${s.items.map((i) => `<li><a href="${base}${i.href}">${esc(i.label)}</a>${i.sub ? ` — ${esc(i.sub)}` : ""}</li>`).join("")}</ul>`)
      .join("");
    await sendEmail(u.email, `HBE Interview: ${actionCount(sections)} thing${actionCount(sections) === 1 ? "" : "s"} waiting for you`, `<p>Hi ${esc(u.name)},</p>${html}<p><a href="${base}/app/inbox">Open your inbox</a> · You can turn this email off on your Security page.</p>`).catch((e) => console.error("digest failed", e));
    sent++;
  }
  return sent;
}
