/**
 * Calendar availability (pure): find times when every connected panelist is free, inside working hours in the
 * scheduler's time zone, on weekdays.
 */

export interface Busy {
  start: Date;
  end: Date;
}

export interface SlotSearch {
  from: Date;
  to: Date;
  durationMin: number;
  /** IANA time zone the working hours are in (the scheduler's). */
  timeZone: string;
  workStartHour: number;
  workEndHour: number;
  stepMin?: number;
  /** Leave at least this long before the first suggestion. */
  minNoticeMin?: number;
  max?: number;
}

/** Local weekday (0 = Sunday) and minutes since local midnight of an instant in a time zone. */
export function localTime(d: Date, timeZone: string): { weekday: number; minutes: number; date: string } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { weekday, minutes: Number(get("hour")) * 60 + Number(get("minute")), date: `${get("year")}-${get("month")}-${get("day")}` };
}

export function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const overlaps = (a0: number, a1: number, b: Busy) => a0 < b.end.getTime() && b.start.getTime() < a1;

/** Start times where nobody in `busyByPerson` is busy, spread across days (at most `perDay` a day first). */
export function freeSlots(busyByPerson: Busy[][], q: SlotSearch, perDay = 3): Date[] {
  const step = (q.stepMin ?? 30) * 60_000;
  const dur = q.durationMin * 60_000;
  const notice = (q.minNoticeMin ?? 120) * 60_000;
  const earliest = Math.max(q.from.getTime(), Date.now() + notice);
  let t = Math.ceil(earliest / step) * step;
  const all = busyByPerson.flat();
  const found: Date[] = [];
  while (t + dur <= q.to.getTime() && found.length < 500) {
    const s = localTime(new Date(t), q.timeZone);
    const e = localTime(new Date(t + dur), q.timeZone);
    const weekday = s.weekday >= 1 && s.weekday <= 5;
    const inHours = s.minutes >= q.workStartHour * 60 && s.date === e.date && e.minutes <= q.workEndHour * 60;
    if (weekday && inHours && !all.some((b) => overlaps(t, t + dur, b))) found.push(new Date(t));
    t += step;
  }
  // Prefer variety: a few per day, then fill.
  const max = q.max ?? 12;
  const byDay = new Map<string, Date[]>();
  for (const d of found) {
    const k = localTime(d, q.timeZone).date;
    byDay.set(k, [...(byDay.get(k) ?? []), d]);
  }
  const spread: Date[] = [];
  for (const ds of byDay.values()) {
    // Morning, midday and afternoon options rather than three consecutive half-hours.
    const pick = ds.length <= perDay ? ds : [0, Math.floor(ds.length / 2), ds.length - 1].map((i) => ds[i]);
    spread.push(...pick.slice(0, perDay));
  }
  const rest = found.filter((d) => !spread.includes(d));
  return [...spread, ...rest].slice(0, max).sort((a, b) => a.getTime() - b.getTime());
}

/** Merge and clip busy intervals (for display and to keep payloads small). */
export function mergeBusy(busy: Busy[]): Busy[] {
  const sorted = [...busy].sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: Busy[] = [];
  for (const b of sorted) {
    const last = out[out.length - 1];
    if (last && b.start.getTime() <= last.end.getTime()) {
      if (b.end > last.end) last.end = b.end;
    } else out.push({ start: new Date(b.start), end: new Date(b.end) });
  }
  return out;
}

/** The email in an OpenID id_token (from the token endpoint over TLS, so the payload is read, not verified). */
export function idTokenEmail(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { email?: string; preferred_username?: string; upn?: string };
    return (payload.email ?? payload.preferred_username ?? payload.upn ?? null)?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}
