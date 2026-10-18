/** Minimal iCalendar (RFC 5545) event files for interview invitations (pure). */

export interface IcsEvent {
  uid: string;
  start: Date;
  durationMin: number;
  summary: string;
  description?: string;
  location?: string;
  /** Increment on every change so calendar apps update the existing event. */
  sequence?: number;
  cancelled?: boolean;
  now?: Date;
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Escape a TEXT value (RFC 5545 §3.3.11). */
export function icsText(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Fold a content line at 75 octets (§3.1), never splitting a UTF-8 character. */
export function foldLine(line: string) {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = out.length ? 74 : 75; // continuation lines start with a space
    if (bytes + n > limit) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export function buildIcs(e: IcsEvent): string {
  const end = new Date(e.start.getTime() + e.durationMin * 60_000);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//HBE Interview//Panel interviews//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${e.cancelled ? "CANCEL" : "PUBLISH"}`,
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `DTSTAMP:${stamp(e.now ?? new Date())}`,
    `DTSTART:${stamp(e.start)}`,
    `DTEND:${stamp(end)}`,
    `SEQUENCE:${e.sequence ?? 0}`,
    `STATUS:${e.cancelled ? "CANCELLED" : "CONFIRMED"}`,
    `SUMMARY:${icsText(e.summary)}`,
    ...(e.location ? [`LOCATION:${icsText(e.location)}`] : []),
    ...(e.description ? [`DESCRIPTION:${icsText(e.description)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
