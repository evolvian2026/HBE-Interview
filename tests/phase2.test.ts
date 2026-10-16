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

import { quoteMatches } from "@/lib/core/evidence";
import { parseRepoUrl, commitStats } from "@/lib/github";
import { detectResumeType } from "@/lib/parse";

describe("phase 3 helpers", () => {
  it("verifies evidence quotes in non-Latin scripts", () => {
    const src = "मैंने Redis कैश जोड़ा जिससे latency 800ms से घटकर 120ms हो गई।";
    expect(quoteMatches("मैंने Redis कैश जोड़ा", src)).toBe(true);
    expect(quoteMatches("मैंने Kafka पाइपलाइन बनाई", src)).toBe(false);
    expect(quoteMatches("أنا صممت النظام", "في مشروعي أنا صممت النظام بالكامل")).toBe(true);
  });
  it("parses GitHub, GitLab (nested groups) and Bitbucket URLs", () => {
    expect(parseRepoUrl("https://github.com/acme/api/tree/main/svc")).toEqual({ host: "github", owner: "acme", repo: "api", branch: "main", subPath: "svc" });
    expect(parseRepoUrl("https://gitlab.com/group/sub/proj/-/tree/dev")).toMatchObject({ host: "gitlab", owner: "group/sub", repo: "proj", branch: "dev" });
    expect(parseRepoUrl("bitbucket.org/team/repo.git")).toMatchObject({ host: "bitbucket", owner: "team", repo: "repo" });
    expect(parseRepoUrl("https://example.com/a/b")).toBeNull();
  });
  it("attributes commits by login, email or name", () => {
    const s = commitStats(
      [
        { login: "ravik", name: "Ravi K", email: "r@x.com", date: "2026-01-01T00:00:00Z", changes: 10 },
        { name: "Ravi K", email: "r@x.com", date: "2026-01-02T00:00:00Z", changes: 30 },
        { name: "Someone", email: "s@y.com", date: "2026-01-02T00:00:00Z", changes: 60 },
      ],
      "ravik",
    );
    expect(s).toMatchObject({ totalCommits: 3, candidateCommits: 2, activeDays: 2 });
    expect(s.largestCommitShare).toBeCloseTo(0.6, 5);
  });
  it("detects resume image types", () => {
    expect(detectResumeType("a.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe("png");
    expect(detectResumeType("a.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
  });
});
