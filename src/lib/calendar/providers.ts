/**
 * Calendar providers over plain HTTPS: Google Calendar and Microsoft 365 (Graph). Each person connects their own
 * calendar (OAuth 2.0 authorization code with a refresh token); HBE Interview reads their free/busy times and creates
 * panel interview events with a Google Meet or Microsoft Teams link. A mock provider (CALENDAR_MOCK=true) is used for
 * development and tests.
 */
import { randomUUID } from "node:crypto";
import { idTokenEmail, type Busy } from "../core/calendar";

export type ProviderId = "google" | "microsoft" | "mock";

export class CalendarError extends Error {
  constructor(
    message: string,
    public reconnect = false,
  ) {
    super(message);
  }
}

export interface Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  email?: string | null;
}

export interface EventInput {
  title: string;
  description: string;
  start: Date;
  end: Date;
  attendees: { email: string; name: string }[];
  location?: string;
  /** Create a Google Meet / Teams link. */
  meeting: boolean;
}

export interface Provider {
  id: ProviderId;
  label: string;
  meetingLabel: string;
  configured(): boolean;
  authUrl(state: string, redirectUri: string): string;
  exchange(code: string, redirectUri: string): Promise<Tokens>;
  refresh(refreshToken: string): Promise<Tokens>;
  busy(accessToken: string, email: string, from: Date, to: Date): Promise<Busy[]>;
  createEvent(accessToken: string, ev: EventInput): Promise<{ id: string; joinUrl: string | null }>;
  updateEvent(accessToken: string, id: string, ev: EventInput): Promise<{ joinUrl: string | null }>;
  deleteEvent(accessToken: string, id: string): Promise<void>;
}

async function form(url: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body), signal: AbortSignal.timeout(15_000) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new CalendarError(`Sign-in with the calendar provider failed (${String(data.error ?? res.status)}).`, data.error === "invalid_grant");
  return data;
}

async function call<T>(url: string, token: string, init: { method?: string; body?: unknown; okStatuses?: number[] } = {}): Promise<T> {
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401) throw new CalendarError("The calendar connection has expired — reconnect it.", true);
  if (!res.ok && !(init.okStatuses ?? []).includes(res.status)) throw new CalendarError(`The calendar provider returned ${res.status}.`);
  return (res.status === 204 || !res.headers.get("content-type")?.includes("json") ? {} : await res.json()) as T;
}

const tokens = (d: Record<string, unknown>): Tokens => ({ accessToken: String(d.access_token), refreshToken: d.refresh_token ? String(d.refresh_token) : undefined, expiresIn: Number(d.expires_in ?? 3600), email: idTokenEmail(d.id_token as string | undefined) });

/* --------------------------------- Google --------------------------------- */

const G_API = "https://www.googleapis.com/calendar/v3";
const google: Provider = {
  id: "google",
  label: "Google Calendar",
  meetingLabel: "Google Meet",
  configured: () => !!process.env.GOOGLE_CALENDAR_CLIENT_ID && !!process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
  authUrl(state, redirectUri) {
    const p = new URLSearchParams({
      client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID!,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: process.env.GOOGLE_CALENDAR_SCOPES ?? "openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  },
  async exchange(code, redirectUri) {
    return tokens(await form("https://oauth2.googleapis.com/token", { code, client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID!, client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET!, redirect_uri: redirectUri, grant_type: "authorization_code" }));
  },
  async refresh(refreshToken) {
    return tokens(await form("https://oauth2.googleapis.com/token", { refresh_token: refreshToken, client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID!, client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET!, grant_type: "refresh_token" }));
  },
  async busy(token, _email, from, to) {
    const r = await call<{ calendars?: Record<string, { busy?: { start: string; end: string }[] }> }>(`${G_API}/freeBusy`, token, { method: "POST", body: { timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: "primary" }] } });
    return (r.calendars?.primary?.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
  },
  async createEvent(token, ev) {
    const body = googleEvent(ev, true);
    const r = await call<GoogleEvent>(`${G_API}/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all`, token, { method: "POST", body });
    let link = googleJoin(r);
    // Meet details are generated asynchronously; read the event once more if the link isn't there yet.
    if (ev.meeting && !link && r.id) {
      await new Promise((res) => setTimeout(res, 1500));
      link = googleJoin(await call<GoogleEvent>(`${G_API}/calendars/primary/events/${encodeURIComponent(r.id)}`, token));
    }
    return { id: r.id, joinUrl: link };
  },
  async updateEvent(token, id, ev) {
    const r = await call<GoogleEvent>(`${G_API}/calendars/primary/events/${encodeURIComponent(id)}?conferenceDataVersion=1&sendUpdates=all`, token, { method: "PATCH", body: googleEvent(ev, false) });
    return { joinUrl: googleJoin(r) };
  },
  async deleteEvent(token, id) {
    await call(`${G_API}/calendars/primary/events/${encodeURIComponent(id)}?sendUpdates=all`, token, { method: "DELETE", okStatuses: [404, 410] });
  },
};

type GoogleEvent = { id: string; hangoutLink?: string; conferenceData?: { entryPoints?: { entryPointType: string; uri: string }[] } };
const googleJoin = (e: GoogleEvent) => e.hangoutLink ?? e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ?? null;
function googleEvent(ev: EventInput, create: boolean) {
  return {
    summary: ev.title,
    description: ev.description,
    start: { dateTime: ev.start.toISOString() },
    end: { dateTime: ev.end.toISOString() },
    attendees: ev.attendees.map((a) => ({ email: a.email, displayName: a.name })),
    ...(ev.location ? { location: ev.location } : {}),
    ...(create && ev.meeting ? { conferenceData: { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } } } : {}),
  };
}

/* -------------------------------- Microsoft -------------------------------- */

const MS_SCOPES = "offline_access openid email Calendars.ReadWrite";
const msTenant = () => process.env.MICROSOFT_CALENDAR_TENANT || "common";
const GRAPH = "https://graph.microsoft.com/v1.0";
const microsoft: Provider = {
  id: "microsoft",
  label: "Microsoft 365 (Outlook)",
  meetingLabel: "Microsoft Teams",
  configured: () => !!process.env.MICROSOFT_CALENDAR_CLIENT_ID && !!process.env.MICROSOFT_CALENDAR_CLIENT_SECRET,
  authUrl(state, redirectUri) {
    const p = new URLSearchParams({ client_id: process.env.MICROSOFT_CALENDAR_CLIENT_ID!, response_type: "code", redirect_uri: redirectUri, response_mode: "query", scope: MS_SCOPES, state, prompt: "select_account" });
    return `https://login.microsoftonline.com/${msTenant()}/oauth2/v2.0/authorize?${p}`;
  },
  async exchange(code, redirectUri) {
    return tokens(await form(`https://login.microsoftonline.com/${msTenant()}/oauth2/v2.0/token`, { client_id: process.env.MICROSOFT_CALENDAR_CLIENT_ID!, client_secret: process.env.MICROSOFT_CALENDAR_CLIENT_SECRET!, code, redirect_uri: redirectUri, grant_type: "authorization_code", scope: MS_SCOPES }));
  },
  async refresh(refreshToken) {
    return tokens(await form(`https://login.microsoftonline.com/${msTenant()}/oauth2/v2.0/token`, { client_id: process.env.MICROSOFT_CALENDAR_CLIENT_ID!, client_secret: process.env.MICROSOFT_CALENDAR_CLIENT_SECRET!, refresh_token: refreshToken, grant_type: "refresh_token", scope: MS_SCOPES }));
  },
  async busy(token, email, from, to) {
    const utc = (d: Date) => ({ dateTime: d.toISOString().replace("Z", ""), timeZone: "UTC" });
    const r = await call<{ value?: { scheduleItems?: { status: string; start: { dateTime: string }; end: { dateTime: string } }[] }[] }>(`${GRAPH}/me/calendar/getSchedule`, token, { method: "POST", body: { schedules: [email], startTime: utc(from), endTime: utc(to), availabilityViewInterval: 30 } });
    const asUtc = (s: string) => new Date(/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`);
    return (r.value?.[0]?.scheduleItems ?? []).filter((i) => i.status !== "free").map((i) => ({ start: asUtc(i.start.dateTime), end: asUtc(i.end.dateTime) }));
  },
  async createEvent(token, ev) {
    const r = await call<{ id: string; onlineMeeting?: { joinUrl?: string } }>(`${GRAPH}/me/events`, token, { method: "POST", body: msEvent(ev, true) });
    return { id: r.id, joinUrl: r.onlineMeeting?.joinUrl ?? null };
  },
  async updateEvent(token, id, ev) {
    const r = await call<{ onlineMeeting?: { joinUrl?: string } }>(`${GRAPH}/me/events/${encodeURIComponent(id)}`, token, { method: "PATCH", body: msEvent(ev, false) });
    return { joinUrl: r.onlineMeeting?.joinUrl ?? null };
  },
  async deleteEvent(token, id) {
    await call(`${GRAPH}/me/events/${encodeURIComponent(id)}`, token, { method: "DELETE", okStatuses: [404] });
  },
};

function msEvent(ev: EventInput, create: boolean) {
  const utc = (d: Date) => ({ dateTime: d.toISOString().replace("Z", ""), timeZone: "UTC" });
  return {
    subject: ev.title,
    body: { contentType: "text", content: ev.description },
    start: utc(ev.start),
    end: utc(ev.end),
    attendees: ev.attendees.map((a) => ({ emailAddress: { address: a.email, name: a.name }, type: "required" })),
    ...(ev.location ? { location: { displayName: ev.location } } : {}),
    ...(create && ev.meeting ? { isOnlineMeeting: true, onlineMeetingProvider: "teamsForBusiness" } : {}),
  };
}

/* ----------------------------------- Mock ----------------------------------- */

function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

/** Deterministic test calendar: busy 12:00–13:00 UTC every day, plus one person-specific hour. */
const mock: Provider = {
  id: "mock",
  label: "Test calendar",
  meetingLabel: "test meeting",
  configured: () => process.env.CALENDAR_MOCK === "true",
  authUrl: (state, redirectUri) => `${redirectUri}?code=mock-code&state=${encodeURIComponent(state)}`,
  exchange: async () => ({ accessToken: "mock-access", refreshToken: "mock-refresh", expiresIn: 3600, email: null }),
  refresh: async () => ({ accessToken: "mock-access", expiresIn: 3600 }),
  async busy(_t, email, from, to) {
    const out: Busy[] = [];
    const extra = 6 + (hash(email) % 4); // a person-specific busy hour between 06:00 and 10:00 UTC
    for (let d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())); d < to; d = new Date(d.getTime() + 86_400_000)) {
      out.push({ start: new Date(d.getTime() + 12 * 3600_000), end: new Date(d.getTime() + 13 * 3600_000) });
      out.push({ start: new Date(d.getTime() + extra * 3600_000), end: new Date(d.getTime() + (extra + 1) * 3600_000) });
    }
    return out.filter((b) => b.end > from && b.start < to);
  },
  createEvent: async (_t, ev) => ({ id: `mock-${randomUUID()}`, joinUrl: ev.meeting ? `https://meet.mock.test/${randomUUID().slice(0, 8)}` : null }),
  updateEvent: async () => ({ joinUrl: null }),
  deleteEvent: async () => undefined,
};

export const PROVIDERS: Record<ProviderId, Provider> = { google, microsoft, mock };
export const providerOf = (id: string): Provider | null => (id in PROVIDERS ? PROVIDERS[id as ProviderId] : null);
export const availableProviders = () => Object.values(PROVIDERS).filter((p) => p.configured());
