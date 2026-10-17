import { describe, expect, it } from "vitest";
import { agreement, agreementAlerts, compareReview, pauseAllowance, recommendationAgreement, sampleReason, weightedKappa, DEFAULT_CALIBRATION } from "@/lib/core/calibration";
import { endPause, initState, LIMITS, pauseLimits, startPause } from "@/lib/core/interview";
import { buildDefaultDriveConfig, enabledRounds } from "@/lib/core/rounds";
import { paramIds } from "@/lib/core/rubrics";
import type { RoleProfile } from "@/lib/core/types";

const PROFILE: RoleProfile = { category: "coding", seniority: "mid", track: "ic", mustHaveSkills: ["Python"], niceToHaveSkills: [], responsibilities: [], leadershipExpectations: [], domain: "fintech", summary: "" };

describe("weighted kappa", () => {
  it("is 1 for perfect agreement and drops with disagreement", () => {
    expect(weightedKappa([[1, 1], [3, 3], [5, 5], [2, 2]])).toBeCloseTo(1);
    const near = weightedKappa([[1, 2], [3, 3], [5, 4], [2, 2]])!;
    const far = weightedKappa([[1, 5], [3, 3], [5, 1], [2, 4]])!;
    expect(near).toBeGreaterThan(0.7);
    expect(far).toBeLessThan(0);
  });
  it("matches a hand-computed value", () => {
    // (1,2), (2,2), (3,3) on a 1–5 scale: observed weighted disagreement 1/16, expected 3/16 → κ = 2/3.
    expect(weightedKappa([[1, 2], [2, 2], [3, 3]])).toBeCloseTo(2 / 3, 10);
  });
  it("handles empty and constant input", () => {
    expect(weightedKappa([])).toBeNull();
    expect(weightedKappa([[3, 3], [3, 3]])).toBe(1);
    expect(weightedKappa([[3, 4], [3, 4]])).toBe(0); // no better than chance
  });
});

describe("agreement statistics", () => {
  it("computes bias, MAE, exact and within-one", () => {
    const s = agreement([[4, 3], [5, 3], [3, 3], [2, 2]]);
    expect(s.n).toBe(4);
    expect(s.bias).toBeCloseTo(0.75);
    expect(s.mae).toBeCloseTo(0.75);
    expect(s.exact).toBeCloseTo(0.5);
    expect(s.withinOne).toBeCloseTo(0.75);
  });
  it("alerts only with enough reviews", () => {
    const harsh = Array.from({ length: 12 }, () => [2, 4] as [number, number]);
    expect(agreementAlerts("Code Quality", agreement(harsh.slice(0, 5)))).toEqual([]);
    const alerts = agreementAlerts("Code Quality", agreement(harsh));
    expect(alerts.some((a) => a.includes("within one point"))).toBe(true);
    expect(alerts.some((a) => a.includes("lower than reviewers by 2.0"))).toBe(true);
    expect(agreementAlerts("x", agreement(Array.from({ length: 12 }, () => [3, 3] as [number, number])))).toEqual([]);
  });
  it("builds the recommendation confusion matrix", () => {
    const r = recommendationAgreement([["hire", "hire"], ["hire", "lean_no"], ["no_hire", "no_hire"], ["strong_hire", "hire"]]);
    expect(r.matrix[1][1]).toBe(1);
    expect(r.matrix[1][2]).toBe(1);
    expect(r.exact).toBeCloseTo(0.5);
    expect(r.sameSide).toBeCloseTo(0.75);
  });
});

describe("review comparison", () => {
  it("flags a 2-point gap or a hire-line flip", () => {
    expect(compareReview({ a: 3, b: 4 }, { a: 4, b: 4 }, "hire", "hire").disagrees).toBe(false);
    expect(compareReview({ a: 2, b: 4 }, { a: 4, b: 4 }, "hire", "hire").disagrees).toBe(true);
    const flip = compareReview({ a: 3 }, { a: 3 }, "lean_no", "hire");
    expect(flip.recommendationFlip).toBe(true);
    expect(flip.disagrees).toBe(true);
    expect(compareReview({ a: 3 }, { a: 3 }, "strong_hire", "hire").disagrees).toBe(false);
  });
  it("ignores parameters the AI didn't score", () => {
    const c = compareReview({ a: 1, b: 3 }, { b: 3, a: null }, "hire", "hire");
    expect(c.params.map((p) => p.id)).toEqual(["b"]);
    expect(c.disagrees).toBe(false);
  });
});

describe("sampling", () => {
  it("is deterministic and close to the configured rate", () => {
    const ids = Array.from({ length: 4000 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const picked = ids.filter((id) => sampleReason(id, "high", { sampleRate: 10, includeLowConfidence: false })).length;
    expect(picked / ids.length).toBeGreaterThan(0.07);
    expect(picked / ids.length).toBeLessThan(0.13);
    expect(sampleReason(ids[7], "high", DEFAULT_CALIBRATION)).toBe(sampleReason(ids[7], "high", DEFAULT_CALIBRATION));
    expect(ids.every((id) => !sampleReason(id, "medium", { sampleRate: 0, includeLowConfidence: true }))).toBe(true);
    expect(sampleReason(ids[0], "low", { sampleRate: 0, includeLowConfidence: true })).toBe("low_confidence");
    expect(ids.every((id) => sampleReason(id, "high", { sampleRate: 100, includeLowConfidence: false }) === "sample")).toBe(true);
  });
});

describe("accommodations in the interview clock", () => {
  const round = enabledRounds(buildDefaultDriveConfig("Backend Engineer", "x".repeat(250), PROFILE))[0];
  it("stretches every section and extends pauses", () => {
    const plain = initState(round, paramIds(round.type));
    const adj = initState(round, paramIds(round.type), { timeFactor: 1.5, ...pauseAllowance(true, LIMITS) });
    plain.sections.forEach((s, i) => expect(adj.sections[i].minutes).toBeCloseTo(s.minutes * 1.5, 1));
    expect(pauseLimits(plain)).toEqual({ maxPauses: 2, maxPauseSec: 120 });
    expect(pauseLimits(adj)).toEqual({ maxPauses: 4, maxPauseSec: 600 });
    let st = adj;
    const t0 = Date.parse("2026-01-01T10:00:00Z");
    for (let i = 0; i < 4; i++) {
      const r = startPause(st, new Date(t0 + i * 1000_000));
      expect(r.error).toBeUndefined();
      const e = endPause(r.state, new Date(t0 + i * 1000_000 + 9 * 60_000));
      expect(e.pausedSec).toBe(9 * 60);
      st = e.state;
    }
    expect(startPause(st, new Date(t0 + 10_000_000)).error).toMatch(/No pauses left/);
    // Standard sessions still cap a pause at two minutes.
    const p = startPause(plain, new Date(t0));
    expect(endPause(p.state, new Date(t0 + 9 * 60_000)).pausedSec).toBe(120);
  });
});
