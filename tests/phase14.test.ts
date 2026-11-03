import { describe, expect, it } from "vitest";
import { BENCH, compareRuns, expectedProblems, mapStrings, parseWrittenTranscript, runMetrics, type BenchResult } from "@/lib/core/benchmark";

const r = (caseId: string, exp: Record<string, number | null>, ai: Record<string, number | null>, over: Partial<BenchResult> = {}): BenchResult => ({
  caseId,
  caseTitle: `Case ${caseId}`,
  repeat: 1,
  expected: { params: exp, recommendation: "hire" },
  params: ai,
  roundScore: 70,
  recommendation: "hire",
  ...over,
});

describe("test bench metrics", () => {
  it("passes when the AI matches the team", () => {
    const m = runMetrics(["a", "b", "c", "d", "e"].map((id) => r(id, { x: 4, y: 3 }, { x: 4, y: 3 })));
    expect(m.verdict).toBe("pass");
    expect(m.overall.mae).toBe(0);
    expect(m.recommendation.sameSide).toBe(1);
    expect(m.lowSample).toBe(false);
  });

  it("flags a lean and big misses, and fails on wrong hire calls", () => {
    const results = [
      r("a", { x: 3, y: 3 }, { x: 4, y: 4 }),
      r("b", { x: 3, y: 3 }, { x: 4, y: 4 }),
      r("c", { x: 2, y: 2 }, { x: 4, y: 4 }, { expected: { params: { x: 2, y: 2 }, recommendation: "no_hire" }, recommendation: "hire" }),
      r("d", { x: 2, y: 2 }, { x: 4, y: 3 }, { expected: { params: { x: 2, y: 2 }, recommendation: "lean_no" }, recommendation: "hire" }),
    ];
    const m = runMetrics(results);
    expect(m.overall.bias).toBeGreaterThan(0);
    expect(m.bigMisses).toBe(2);
    expect(m.recommendation.sameSide).toBe(0.5);
    expect(m.verdict).toBe("fail");
    expect(m.reasons.join(" ")).toMatch(/more generously/);
    expect(m.lowSample).toBe(true);
  });

  it("ignores parameters the team marked as not assessable", () => {
    const m = runMetrics([r("a", { x: 4, y: null }, { x: 4, y: 1 })]);
    expect(m.overall.n).toBe(1);
    expect(m.byParameter.y).toBeUndefined();
  });

  it("detects inconsistent repeated scoring", () => {
    const results = [
      r("a", { x: 4 }, { x: 4 }, { repeat: 1, roundScore: 80 }),
      r("a", { x: 4 }, { x: 4 }, { repeat: 2, roundScore: 60, recommendation: "lean_no" }),
      r("b", { x: 4 }, { x: 4 }, { repeat: 1 }),
      r("b", { x: 4 }, { x: 4 }, { repeat: 2 }),
    ];
    const m = runMetrics(results);
    expect(m.repeats).toBe(2);
    expect(m.unstable).toBe(1);
    expect(m.outcomes.find((o) => o.caseId === "a")).toMatchObject({ recommendationChanged: true, scoreRange: 20, unstable: true });
    expect(m.verdict).toBe("fail");
  });

  it("compares two runs case by case", () => {
    const base = [r("a", { x: 4 }, { x: 4 }, { roundScore: 70 }), r("b", { x: 3 }, { x: 3 }, { roundScore: 60 })];
    const now = [r("a", { x: 4 }, { x: 3 }, { roundScore: 55, recommendation: "lean_no" }), r("b", { x: 3 }, { x: 3 }, { roundScore: 62 }), r("c", { x: 3 }, { x: 3 })];
    const c = compareRuns(now, base);
    expect(c.cases).toBe(2);
    expect(c.meanShift).toBe(-6.5);
    expect(c.crossedHireLine.map((x) => x.caseId)).toEqual(["a"]);
    expect(c.bigMoves.map((x) => x.caseId)).toEqual(["a"]);
  });

  it("uses documented thresholds", () => {
    expect(BENCH.passMae).toBeLessThan(BENCH.failMae);
    expect(BENCH.failSameSide).toBeLessThan(BENCH.passSameSide);
  });
});

describe("written cases", () => {
  it("parses interviewer and candidate lines with continuations", () => {
    const { messages, problems } = parseWrittenTranscript("Interviewer: Hi\nCandidate: Hello there\nmore detail\nAI: Why?\nC: Because it scales");
    expect(problems).toEqual([]);
    expect(messages).toHaveLength(4);
    expect(messages[1]).toMatchObject({ seq: 2, role: "candidate", content: "Hello there\nmore detail" });
    expect(messages[3].role).toBe("candidate");
  });
  it("explains what's missing", () => {
    expect(parseWrittenTranscript("just some text").problems.join(" ")).toMatch(/Interviewer:/);
    expect(parseWrittenTranscript("Candidate: only me").problems.join(" ")).toMatch(/two candidate answers/);
  });
  it("validates expected scores", () => {
    expect(expectedProblems({ params: { x: 4 }, recommendation: "hire" }, ["x"])).toEqual([]);
    expect(expectedProblems({ params: { x: 6, z: 3 }, recommendation: "maybe" }, ["x"])).toHaveLength(3);
    expect(expectedProblems({ params: { x: null }, recommendation: "hire" }, ["x"]).join(" ")).toMatch(/at least one/);
  });
  it("maps every string in nested data", () => {
    expect(mapStrings({ a: "Asha", b: [{ c: "Asha V" }], n: 3 }, (s) => s.replace("Asha", "[NAME]"))).toEqual({ a: "[NAME]", b: [{ c: "[NAME] V" }], n: 3 });
  });
});
