import { describe, expect, it } from "vitest";
import { buildIcs, foldLine, icsText } from "@/lib/core/ics";
import { defaultCompetencies, slotProblem, summarisePanel } from "@/lib/core/panel";
import type { RoleProfile } from "@/lib/core/types";

const profile = (over: Partial<RoleProfile> = {}): RoleProfile => ({ category: "coding", seniority: "mid", track: "ic", mustHaveSkills: [], niceToHaveSkills: [], responsibilities: [], leadershipExpectations: [], domain: "", summary: "", ...over });

describe("iCalendar", () => {
  it("escapes text and folds long lines at 75 octets", () => {
    expect(icsText("a,b;c\\d\nnext")).toBe(String.raw`a\,b\;c\\d\nnext`);
    const folded = foldLine("SUMMARY:" + "x".repeat(200));
    const parts = folded.split("\r\n");
    expect(parts.every((p) => new TextEncoder().encode(p).length <= 75)).toBe(true);
    expect(parts.slice(1).every((p) => p.startsWith(" "))).toBe(true);
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join("")).toBe("SUMMARY:" + "x".repeat(200));
  });
  it("never splits a multi-byte character", () => {
    const line = "SUMMARY:" + "साक्षात्कार ".repeat(20);
    const parts = foldLine(line).split("\r\n");
    expect(parts.every((p) => new TextEncoder().encode(p).length <= 75)).toBe(true);
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join("")).toBe(line);
  });
  it("builds a UTC event with sequence and cancellation", () => {
    const ics = buildIcs({ uid: "panel-1@hbe", start: new Date("2026-11-03T09:30:00Z"), durationMin: 45, summary: "Final panel, Asha", location: "https://meet.example.com/x", sequence: 2, now: new Date("2026-10-18T00:00:00Z") });
    expect(ics).toContain("DTSTART:20261103T093000Z\r\n");
    expect(ics).toContain("DTEND:20261103T101500Z\r\n");
    expect(ics).toContain("DTSTAMP:20261018T000000Z\r\n");
    expect(ics).toContain("SEQUENCE:2\r\n");
    expect(ics).toContain("SUMMARY:Final panel\\, Asha\r\n");
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    const cancelled = buildIcs({ uid: "u", start: new Date(), durationMin: 30, summary: "s", cancelled: true });
    expect(cancelled).toContain("METHOD:CANCEL");
    expect(cancelled).toContain("STATUS:CANCELLED");
  });
});

describe("panel rules", () => {
  it("suggests competencies from the role", () => {
    expect(defaultCompetencies({ roleProfile: profile() })).toContain("System design");
    expect(defaultCompetencies({ roleProfile: profile({ track: "manager", seniority: "manager" }) })).toContain("Leadership");
    expect(defaultCompetencies({ roleProfile: profile({ category: "non_technical" }) })).toContain("Functional expertise");
    expect(defaultCompetencies({ roleProfile: profile({ seniority: "director", track: "manager" }) }).length).toBeLessThanOrEqual(8);
  });
  it("validates offered slots", () => {
    const now = new Date("2026-10-18T10:00:00Z");
    const t = (h: number) => new Date(now.getTime() + h * 3600_000).toISOString();
    expect(slotProblem([], now)).toMatch(/at least one/);
    expect(slotProblem([t(1), t(2)], now)).toBeNull();
    expect(slotProblem([t(-1)], now)).toMatch(/future/);
    expect(slotProblem([t(1), t(1)], now)).toMatch(/twice/);
    expect(slotProblem(["not a date"], now)).toMatch(/valid/);
    expect(slotProblem([t(24 * 400)], now)).toMatch(/year/);
    expect(slotProblem([1, 2, 3, 4, 5, 6].map(t), now)).toMatch(/at most 5/);
  });
  it("summarises scorecards, ignoring unsubmitted ones, and detects splits", () => {
    const at = new Date();
    const s = summarisePanel(["Depth", "Communication"], [
      { ratings: { Depth: 4, Communication: 3 }, recommendation: "hire", submittedAt: at },
      { ratings: { Depth: 2, Communication: 3 }, recommendation: "lean_no", submittedAt: at },
      { ratings: { Depth: 5 }, recommendation: "strong_hire", submittedAt: null },
    ]);
    expect(s.submitted).toBe(2);
    expect(s.pending).toBe(1);
    expect(s.competencies[0]).toMatchObject({ n: 2, mean: 3, min: 2, max: 4, split: true });
    expect(s.competencies[1].split).toBe(false);
    expect(s.split).toBe(true);
    expect(s.hireVotes).toBe(1);
    // Tie between Hire and Lean No → the more cautious one.
    expect(s.consensus).toBe("lean_no");
  });
  it("reports agreement when the panel is aligned", () => {
    const at = new Date();
    const s = summarisePanel(["Depth"], [
      { ratings: { Depth: 4 }, recommendation: "hire", submittedAt: at },
      { ratings: { Depth: 5 }, recommendation: "strong_hire", submittedAt: at },
      { ratings: { Depth: 4 }, recommendation: "hire", submittedAt: at },
    ]);
    expect(s.split).toBe(false);
    expect(s.consensus).toBe("hire");
    expect(s.hireVotes).toBe(3);
    expect(summarisePanel(["Depth"], []).consensus).toBeNull();
  });
});
