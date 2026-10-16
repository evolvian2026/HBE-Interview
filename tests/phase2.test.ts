import { describe, expect, it } from "vitest";
import { csvToInvitees, parseCsv } from "@/lib/csv";
import { bins10, estimateCost } from "@/lib/core/metrics";
import { buildDefaultDriveConfig, enabledRounds } from "@/lib/core/rounds";
import type { RoleProfile } from "@/lib/core/types";

describe("CSV invites", () => {
  it("parses quoted fields, header in any order, semicolons and CRLF", () => {
    expect(parseCsv('a,"b, c","d ""q"""\r\n1,2,3')).toEqual([["a", "b, c", 'd "q"'], ["1", "2", "3"]]);
    expect(csvToInvitees("Email;Full name\r\npriya@x.com;Priya Sharma\nbad-row;No Email\n")).toEqual([{ name: "Priya Sharma", email: "priya@x.com" }]);
    expect(csvToInvitees("Ravi Kumar,ravi@x.com\n\"Iyer, Meena\",meena@x.com")).toEqual([
      { name: "Ravi Kumar", email: "ravi@x.com" },
      { name: "Iyer, Meena", email: "meena@x.com" },
    ]);
  });
});

describe("analytics helpers", () => {
  it("bins scores into ten buckets with 100 in the top bin", () => {
    const b = bins10([0, 9, 10, 65, 99, 100]);
    expect(b.map((x) => x.count)).toEqual([2, 1, 0, 0, 0, 0, 1, 0, 0, 2]);
    expect(b[9].label).toBe("90–100");
  });
  it("estimates cost from token usage", () => {
    expect(estimateCost("claude-opus-5-5", { input: 1_000_000, output: 100_000, cacheRead: 0, cacheWrite: 0 })).toBeCloseTo(4 + 2, 5);
    expect(estimateCost("claude-haiku-5-5", { input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 0 })).toBeCloseTo(0.01, 5);
  });
});

describe("prioritisation section", () => {
  const p = (seniority: RoleProfile["seniority"], track: RoleProfile["track"]): RoleProfile => ({
    category: "coding", seniority, track, mustHaveSkills: [], niceToHaveSkills: [], responsibilities: [], leadershipExpectations: [], domain: "", summary: "",
  });
  it("is enabled by default for managers and available (off) for senior ICs", () => {
    const mgr = enabledRounds(buildDefaultDriveConfig("t", "x".repeat(250), p("manager", "manager"))).find((r) => r.type === "managerial")!;
    expect(mgr.sections.find((s) => s.key === "prioritize")?.enabled).toBe(true);
    const ic = enabledRounds(buildDefaultDriveConfig("t", "x".repeat(250), p("senior", "ic"))).find((r) => r.type === "managerial")!;
    expect(ic.sections.find((s) => s.key === "prioritize")?.enabled).toBe(false);
    expect(mgr.durationMin).toBe(mgr.sections.filter((s) => s.enabled).reduce((a, s) => a + s.minutes, 0));
  });
});
