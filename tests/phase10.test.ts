import { describe, expect, it } from "vitest";
import { matchRole, normaliseSkill, parseResumeDate, yearsOfExperience } from "@/lib/core/matching";

describe("skill normalisation", () => {
  it("folds case, punctuation and common aliases", () => {
    expect(normaliseSkill("Node.js")).toBe("nodejs");
    expect(normaliseSkill(" K8s ")).toBe("kubernetes");
    expect(normaliseSkill("Postgres")).toBe("postgresql");
    expect(normaliseSkill("TS")).toBe("typescript");
    expect(normaliseSkill("C#")).toBe("c#");
    expect(normaliseSkill("CI/CD")).toBe("ci/cd");
    expect(normaliseSkill("React (hooks)")).toBe("react");
  });
});

describe("role matching", () => {
  const role = { mustHaveSkills: ["Node.js", "PostgreSQL", "Kubernetes", "Go"], niceToHaveSkills: ["Kafka", "Terraform"], seniority: "senior" as const };
  it("scores coverage and explains it", () => {
    const r = matchRole({ skills: ["nodejs", "Postgres", "k8s", "Kafka", "Google Cloud"], years: 6 }, role);
    expect(r.matchedMust).toEqual(["Node.js", "PostgreSQL", "Kubernetes"]);
    expect(r.missingMust).toEqual(["Go"]); // "google cloud" must not satisfy "go"
    expect(r.matchedNice).toEqual(["Kafka"]);
    expect(r.yearsOk).toBe(true);
    expect(r.score).toBe(Math.round(70 * 0.75 + 20 * 0.5 + 10));
  });
  it("does not confuse Java with JavaScript", () => {
    const r = matchRole({ skills: ["JavaScript"], years: null }, { mustHaveSkills: ["Java"], niceToHaveSkills: [], seniority: "mid" });
    expect(r.matchedMust).toEqual([]);
    expect(r.yearsOk).toBeNull();
    expect(r.score).toBe(0 + 10 + 5);
  });
  it("accepts a more specific skill for a general requirement", () => {
    expect(matchRole({ skills: ["AWS Lambda"], years: 1 }, { mustHaveSkills: ["AWS"], niceToHaveSkills: [], seniority: "senior" }).matchedMust).toEqual(["AWS"]);
  });
  it("penalises too little experience", () => {
    const a = matchRole({ skills: ["Go"], years: 2 }, { mustHaveSkills: ["Go"], niceToHaveSkills: [], seniority: "senior" });
    const b = matchRole({ skills: ["Go"], years: 8 }, { mustHaveSkills: ["Go"], niceToHaveSkills: [], seniority: "senior" });
    expect(b.score - a.score).toBe(10);
  });
});

describe("experience dates", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  it("parses common resume date formats", () => {
    expect(parseResumeDate("2019", now)?.getUTCFullYear()).toBe(2019);
    expect(parseResumeDate("Mar 2021", now)?.toISOString()).toBe("2021-03-01T00:00:00.000Z");
    expect(parseResumeDate("03/2021", now)?.toISOString()).toBe("2021-03-01T00:00:00.000Z");
    expect(parseResumeDate("2021-03", now)?.toISOString()).toBe("2021-03-01T00:00:00.000Z");
    expect(parseResumeDate("Present", now)).toEqual(now);
    expect(parseResumeDate("", now)).toBeNull();
  });
  it("sums experience counting overlaps once", () => {
    const y = yearsOfExperience(
      [
        { start: "2018", end: "2021" },
        { start: "2020", end: "2022" }, // overlaps 2020–2021
        { start: "2024", end: "present" },
      ],
      now,
    )!;
    expect(y).toBeCloseTo(4 + 2.75, 1);
    expect(yearsOfExperience([{ start: "", end: "" }], now)).toBeNull();
  });
});
