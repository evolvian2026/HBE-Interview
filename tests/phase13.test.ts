import { describe, expect, it } from "vitest";
import { isPractice, PRACTICE_GUIDE, PRACTICE_INDEX, PRACTICE_MINUTES, practiceQuestion, practiceRound } from "@/lib/core/practice";
import { initState } from "@/lib/core/interview";
import { paramIds } from "@/lib/core/rubrics";
import { buildDefaultDriveConfig } from "@/lib/core/rounds";
import type { RoleProfile } from "@/lib/core/types";

const profile = (over: Partial<RoleProfile> = {}): RoleProfile => ({ category: "coding", seniority: "mid", track: "ic", mustHaveSkills: ["Go"], niceToHaveSkills: [], responsibilities: [], leadershipExpectations: [], domain: "", summary: "", ...over });

describe("practice round", () => {
  const config = buildDefaultDriveConfig("Backend Engineer", "x".repeat(250), profile());
  it("is short, sums its sections to the duration and never gates anything", () => {
    const r = practiceRound(config);
    expect(r.durationMin).toBe(PRACTICE_MINUTES);
    expect(r.sections.reduce((n, s) => n + s.minutes, 0)).toBe(PRACTICE_MINUTES);
    expect(r.sections.every((s) => !s.exercise)).toBe(true);
    expect(r.gate.mode).toBe("always");
    expect(r.personaName).toBe(config.rounds.find((x) => x.enabled)!.personaName);
  });
  it("has a guide for every section and works with the interview state machine", () => {
    const r = practiceRound(config);
    for (const s of r.sections) expect(PRACTICE_GUIDE[s.key]).toBeTruthy();
    const st = initState(r, paramIds(r.type));
    expect(st.sections.map((s) => s.key)).toEqual(["practice_intro", "practice_sample", "wrapup"]);
  });
  it("asks a question that suits the role", () => {
    expect(practiceQuestion({ roleProfile: profile() })).toMatch(/technical problem/);
    expect(practiceQuestion({ roleProfile: profile({ category: "non_technical", track: "manager" }) })).toMatch(/team/);
    expect(practiceQuestion({ roleProfile: profile({ category: "non_technical" }) })).toMatch(/proud/);
  });
  it("uses a negative index so it never collides with real rounds", () => {
    expect(isPractice(PRACTICE_INDEX)).toBe(true);
    expect(isPractice(0)).toBe(false);
  });
});

describe("practice guidance", () => {
  it("uses the practice objective for practice sessions only", async () => {
    const { sectionGuide } = await import("@/lib/interview/sections");
    expect(sectionGuide("hr", "wrapup", false, true).objective).toMatch(/tips/);
    expect(sectionGuide("hr", "wrapup", false).objective).toMatch(/knowledge base/);
    expect(sectionGuide("hr", "practice_intro", false, true).objective).toMatch(/unscored practice/);
  });
});
