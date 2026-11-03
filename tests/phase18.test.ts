import { describe, expect, it } from "vitest";
import { freeSlots, idTokenEmail, isValidTimeZone, localTime, mergeBusy } from "@/lib/core/calendar";

const at = (s: string) => new Date(s);
// A Monday a year ahead (so "minimum notice" never interferes).
const MON = "2027-11-01";

describe("local time", () => {
  it("converts instants to the scheduler's time zone", () => {
    expect(localTime(at(`${MON}T03:30:00Z`), "Asia/Kolkata")).toMatchObject({ weekday: 1, minutes: 9 * 60, date: MON });
    expect(localTime(at(`${MON}T03:30:00Z`), "America/New_York").weekday).toBe(0);
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("Mars/Base")).toBe(false);
  });
});

describe("free slots", () => {
  const q = { from: at(`${MON}T00:00:00Z`), to: at("2027-11-03T00:00:00Z"), durationMin: 60, timeZone: "Asia/Kolkata", workStartHour: 9, workEndHour: 18 };
  it("stays inside working hours on weekdays and avoids everyone's busy time", () => {
    const busyA = [{ start: at(`${MON}T03:30:00Z`), end: at(`${MON}T06:30:00Z`) }]; // 09:00–12:00 IST
    const busyB = [{ start: at(`${MON}T08:30:00Z`), end: at(`${MON}T09:30:00Z`) }]; // 14:00–15:00 IST
    const slots = freeSlots([busyA, busyB], { ...q, max: 50 }, 50);
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      const l = localTime(s, "Asia/Kolkata");
      expect(l.weekday).toBeGreaterThanOrEqual(1);
      expect(l.minutes).toBeGreaterThanOrEqual(9 * 60);
      expect(l.minutes + 60).toBeLessThanOrEqual(18 * 60);
      const t = s.getTime();
      for (const b of [...busyA, ...busyB]) expect(t < b.end.getTime() && b.start.getTime() < t + 3600_000).toBe(false);
    }
    expect(slots.some((s) => localTime(s, "Asia/Kolkata").minutes === 12 * 60)).toBe(true);
  });
  it("skips weekends and spreads suggestions across days", () => {
    const weekend = freeSlots([], { ...q, from: at("2027-11-06T00:00:00Z"), to: at("2027-11-08T00:00:00Z") });
    expect(weekend).toEqual([]);
    const slots = freeSlots([], { ...q, max: 6 });
    const days = new Set(slots.map((s) => localTime(s, "Asia/Kolkata").date));
    expect(days.size).toBe(2);
    expect(slots).toEqual([...slots].sort((a, b) => a.getTime() - b.getTime()));
  });
  it("never suggests a time that has passed or is too soon", () => {
    const now = Date.now();
    const slots = freeSlots([], { from: new Date(now - 86_400_000), to: new Date(now + 7 * 86_400_000), durationMin: 30, timeZone: "UTC", workStartHour: 0, workEndHour: 24, max: 3 });
    for (const s of slots) expect(s.getTime()).toBeGreaterThanOrEqual(now + 120 * 60_000 - 1);
  });
});

describe("helpers", () => {
  it("merges overlapping busy blocks", () => {
    const m = mergeBusy([
      { start: at(`${MON}T10:00:00Z`), end: at(`${MON}T11:00:00Z`) },
      { start: at(`${MON}T10:30:00Z`), end: at(`${MON}T12:00:00Z`) },
      { start: at(`${MON}T13:00:00Z`), end: at(`${MON}T14:00:00Z`) },
    ]);
    expect(m.map((b) => b.end.toISOString())).toEqual([`${MON}T12:00:00.000Z`, `${MON}T14:00:00.000Z`]);
  });
  it("reads the account email from an id token", () => {
    const tok = (p: object) => `x.${Buffer.from(JSON.stringify(p)).toString("base64url")}.y`;
    expect(idTokenEmail(tok({ email: "Ana@Example.com" }))).toBe("ana@example.com");
    expect(idTokenEmail(tok({ preferred_username: "raj@contoso.com" }))).toBe("raj@contoso.com");
    expect(idTokenEmail("garbage")).toBeNull();
  });
});
