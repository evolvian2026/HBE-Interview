/**
 * Calendar sync for panel interviews: people connect their own calendar; schedulers get times when every connected
 * panelist is free; booking creates (and rescheduling/cancelling updates or removes) the event in the organiser's
 * calendar with a Google Meet or Teams link, sent to the panelists. Calendar problems never block scheduling — the
 * interview still goes ahead with the calendar file (ICS) and emails, and the problem is shown to staff.
 */
import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import { HttpError, type StaffUser } from "../auth/staff";
import { audit } from "../audit";
import { env } from "../env";
import { seal, unseal } from "../security/secrets";
import { freeSlots, isValidTimeZone, mergeBusy, type Busy } from "../core/calendar";
import { CalendarError, availableProviders, providerOf, type EventInput, type Provider } from "../calendar/providers";

type Conn = typeof schema.calendarConnections.$inferSelect;

export const redirectUri = (provider: string) => `${env.appBaseUrl.replace(/\/$/, "")}/api/calendar/callback/${provider}`;

export function calendarProviders() {
  return availableProviders().map((p) => ({ id: p.id, label: p.label, meetingLabel: p.meetingLabel }));
}

/* ------------------------------- Connecting ------------------------------- */

export function startConnect(providerId: string) {
  const p = providerOf(providerId);
  if (!p || !p.configured()) throw new HttpError(404, "This calendar provider isn't set up on this server.");
  const state = randomBytes(24).toString("base64url");
  return { state, url: p.authUrl(state, redirectUri(p.id)) };
}

export async function finishConnect(user: StaffUser, providerId: string, code: string) {
  const p = providerOf(providerId);
  if (!p || !p.configured()) throw new HttpError(404, "This calendar provider isn't set up on this server.");
  const t = await p.exchange(code, redirectUri(p.id));
  if (!t.refreshToken) throw new HttpError(400, "The calendar provider didn't grant ongoing access — please try connecting again.");
  const values = {
    userId: user.id,
    orgId: user.orgId,
    provider: p.id,
    accountEmail: (t.email ?? user.email).toLowerCase(),
    refreshToken: seal(t.refreshToken),
    accessToken: seal(t.accessToken),
    accessExpiresAt: new Date(Date.now() + (t.expiresIn - 60) * 1000),
    lastError: null,
    connectedAt: new Date(),
  };
  await db.insert(schema.calendarConnections).values(values).onConflictDoUpdate({ target: schema.calendarConnections.userId, set: values });
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "calendar.connect", "user", user.id, { provider: p.id });
}

export async function disconnect(user: StaffUser) {
  await db.delete(schema.calendarConnections).where(eq(schema.calendarConnections.userId, user.id));
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "calendar.disconnect", "user", user.id);
}

export async function connectionOf(userId: string) {
  const [c] = await db.select().from(schema.calendarConnections).where(eq(schema.calendarConnections.userId, userId));
  return c ?? null;
}

/** A usable access token, refreshing it when needed. Marks the connection as needing reconnection on failure. */
async function withToken<T>(c: Conn, fn: (p: Provider, token: string) => Promise<T>): Promise<T> {
  const p = providerOf(c.provider);
  if (!p || !p.configured()) throw new CalendarError(`${c.provider} calendars aren't set up on this server any more.`);
  try {
    let token = c.accessToken ? unseal(c.accessToken) : "";
    if (!token || !c.accessExpiresAt || c.accessExpiresAt.getTime() < Date.now() + 30_000) {
      const t = await p.refresh(unseal(c.refreshToken));
      token = t.accessToken;
      await db
        .update(schema.calendarConnections)
        .set({ accessToken: seal(t.accessToken), accessExpiresAt: new Date(Date.now() + (t.expiresIn - 60) * 1000), ...(t.refreshToken ? { refreshToken: seal(t.refreshToken) } : {}) })
        .where(eq(schema.calendarConnections.userId, c.userId));
    }
    const out = await fn(p, token);
    if (c.lastError) await db.update(schema.calendarConnections).set({ lastError: null }).where(eq(schema.calendarConnections.userId, c.userId));
    return out;
  } catch (e) {
    const msg = e instanceof CalendarError ? e.message : "The calendar couldn't be reached.";
    await db.update(schema.calendarConnections).set({ lastError: msg.slice(0, 300) }).where(eq(schema.calendarConnections.userId, c.userId));
    throw e instanceof CalendarError ? e : new CalendarError(msg);
  }
}

/* ---------------------------- Suggesting times ---------------------------- */

export interface SuggestInput {
  panelistIds: string[];
  durationMin: number;
  timeZone: string;
  days: number;
  workStartHour: number;
  workEndHour: number;
}

export async function suggestTimes(user: StaffUser, input: SuggestInput) {
  if (!isValidTimeZone(input.timeZone)) throw new HttpError(400, "Unknown time zone.");
  if (input.workEndHour - input.workStartHour < 1) throw new HttpError(400, "Working hours must be at least an hour long.");
  const people = input.panelistIds.length
    ? await db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email }).from(schema.users).where(and(inArray(schema.users.id, input.panelistIds), eq(schema.users.orgId, user.orgId)))
    : [];
  if (people.length !== new Set(input.panelistIds).size) throw new HttpError(400, "Choose panelists from your organisation.");
  const conns = people.length ? await db.select().from(schema.calendarConnections).where(inArray(schema.calendarConnections.userId, people.map((p) => p.id))) : [];
  const from = new Date();
  const to = new Date(Date.now() + Math.min(21, Math.max(1, input.days)) * 86_400_000);
  const busy: Busy[][] = [];
  const checked: string[] = [];
  const failed: { name: string; reason: string }[] = [];
  await Promise.all(
    people.map(async (p) => {
      const c = conns.find((x) => x.userId === p.id);
      if (!c) return;
      try {
        busy.push(mergeBusy(await withToken(c, (prov, token) => prov.busy(token, c.accountEmail, from, to))));
        checked.push(p.name);
      } catch (e) {
        failed.push({ name: p.name, reason: (e as Error).message });
      }
    }),
  );
  const slots = freeSlots(busy, { from, to, durationMin: input.durationMin, timeZone: input.timeZone, workStartHour: input.workStartHour, workEndHour: input.workEndHour });
  return {
    slots: slots.map((s) => s.toISOString()),
    checked: checked.sort(),
    notConnected: people.filter((p) => !conns.some((c) => c.userId === p.id)).map((p) => p.name).sort(),
    failed,
  };
}

/* ------------------------------ Event sync ------------------------------ */

/** Whose calendar will hold the event: the scheduler if connected, otherwise the first connected panelist. */
export async function eventOwner(creatorId: string | null, panelistIds: string[]) {
  const ids = [...(creatorId ? [creatorId] : []), ...panelistIds];
  if (!ids.length) return null;
  const conns = await db.select().from(schema.calendarConnections).where(inArray(schema.calendarConnections.userId, ids));
  for (const id of ids) {
    const c = conns.find((x) => x.userId === id);
    if (c && providerOf(c.provider)?.configured()) return c;
  }
  return null;
}

export const AUTO_LOCATION = "Video meeting — the link is sent when the time is booked";

/**
 * Bring the calendar event in line with the interview: create it when booked, move it when the time changes, remove
 * it when the interview is cancelled or waiting for new times. Never throws; returns the (possibly updated) interview.
 */
export async function syncInterviewEvent(interviewId: string) {
  const [iv] = await db.select().from(schema.panelInterviews).where(eq(schema.panelInterviews.id, interviewId));
  if (!iv) return null;
  const cards = await db
    .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
    .from(schema.panelScorecards)
    .innerJoin(schema.users, eq(schema.panelScorecards.panelistId, schema.users.id))
    .where(eq(schema.panelScorecards.interviewId, iv.id));
  // Keep the calendar that already holds the event; otherwise the scheduler's, or the first connected panelist's.
  const ownerConn = (iv.calendarOwnerId ? await connectionOf(iv.calendarOwnerId) : null) ?? (await eventOwner(iv.createdBy, cards.map((c) => c.id)));
  if (!ownerConn) {
    if (iv.autoMeeting && iv.status === "scheduled") return setError(iv.id, "No connected calendar to create the meeting in — connect a calendar (Security page) or add a link by rescheduling.");
    return iv;
  }
  const [cand] = await db
    .select({ name: schema.candidates.name, title: schema.drives.title })
    .from(schema.candidacies)
    .innerJoin(schema.candidates, eq(schema.candidacies.candidateId, schema.candidates.id))
    .innerJoin(schema.drives, eq(schema.candidacies.driveId, schema.drives.id))
    .where(eq(schema.candidacies.id, iv.candidacyId));
  const ev: EventInput = {
    title: `${iv.title}: ${cand?.name ?? "candidate"} (${cand?.title ?? ""})`,
    description: `Panel interview for ${cand?.name ?? "a candidate"} — ${cand?.title ?? ""}.\nInterview kit and scorecard: ${env.appBaseUrl.replace(/\/$/, "")}/app/panel/${iv.id}\nPlease submit your scorecard before reading other panelists' feedback.`,
    start: iv.scheduledAt ?? new Date(),
    end: new Date((iv.scheduledAt ?? new Date()).getTime() + iv.durationMin * 60_000),
    attendees: cards.map((c) => ({ email: c.email, name: c.name })),
    location: iv.autoMeeting ? undefined : iv.location,
    meeting: iv.autoMeeting,
  };
  try {
    if (iv.status === "scheduled" && iv.scheduledAt) {
      if (iv.calendarEventId && iv.calendarOwnerId === ownerConn.userId) {
        const r = await withToken(ownerConn, (p, t) => p.updateEvent(t, iv.calendarEventId!, ev));
        return save(iv.id, { calendarError: null, ...(iv.autoMeeting && r.joinUrl ? { location: r.joinUrl } : {}) });
      }
      const r = await withToken(ownerConn, (p, t) => p.createEvent(t, ev));
      return save(iv.id, { calendarEventId: r.id, calendarProvider: ownerConn.provider, calendarOwnerId: ownerConn.userId, calendarError: iv.autoMeeting && !r.joinUrl ? "The event was created but no video link came back — add one by rescheduling." : null, ...(iv.autoMeeting && r.joinUrl ? { location: r.joinUrl } : {}) });
    }
    if (iv.calendarEventId) {
      await withToken(ownerConn, (p, t) => p.deleteEvent(t, iv.calendarEventId!));
      return save(iv.id, { calendarEventId: null, calendarError: null, ...(iv.autoMeeting ? { location: AUTO_LOCATION } : {}) });
    }
    return iv;
  } catch (e) {
    return setError(iv.id, `Calendar update failed: ${(e as Error).message}`);
  }
}

async function save(id: string, set: Partial<typeof schema.panelInterviews.$inferInsert>) {
  const [u] = await db.update(schema.panelInterviews).set({ ...set, updatedAt: new Date() }).where(eq(schema.panelInterviews.id, id)).returning();
  return u;
}
const setError = (id: string, msg: string) => save(id, { calendarError: msg.slice(0, 400) });

/** Before arranging an interview with an automatic meeting link: someone involved must have a calendar connected. */
export async function requireMeetingCalendar(creatorId: string, panelistIds: string[]) {
  const owner = await eventOwner(creatorId, panelistIds);
  if (!owner) throw new HttpError(400, "To create the video meeting automatically, you or a panelist needs to connect a calendar (Security page). Or enter a link yourself.");
  return owner;
}

export async function calendarStatusFor(userIds: string[]) {
  if (!userIds.length) return new Map<string, { provider: string; error: string | null }>();
  const conns = await db.select({ userId: schema.calendarConnections.userId, provider: schema.calendarConnections.provider, lastError: schema.calendarConnections.lastError }).from(schema.calendarConnections).where(inArray(schema.calendarConnections.userId, userIds));
  return new Map(conns.map((c) => [c.userId, { provider: c.provider, error: c.lastError }]));
}
