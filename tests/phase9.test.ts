import { describe, expect, it } from "vitest";
import { aiVsDecision, days, funnel, median, normaliseTags, panelAgreement } from "@/lib/core/insights";

describe("insights maths", () => {
  it("medians and day differences", () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([1, Number.NaN, 3])).toBe(2);
    expect(days("2026-10-01T00:00:00Z", "2026-10-03T12:00:00Z")).toBe(2.5);
  });
  it("funnel conversion from the previous step and from the start", () => {
    const f = funnel([
      { label: "Invited", value: 100 },
      { label: "Consented", value: 80 },
      { label: "Done", value: 40 },
      { label: "Offer", value: 0 },
    ]);
    expect(f[0].fromPrevious).toBeNull();
    expect(f[1].fromPrevious).toBeCloseTo(0.8);
    expect(f[2].fromPrevious).toBeCloseTo(0.5);
    expect(f[2].fromStart).toBeCloseTo(0.4);
    expect(funnel([{ label: "a", value: 0 }, { label: "b", value: 0 }])[1].fromPrevious).toBeNull();
  });
  it("AI vs final decision", () => {
    const r = aiVsDecision([
      { ai: "hire", decision: "offer" },
      { ai: "strong_hire", decision: "reject" },
      { ai: "lean_no", decision: "offer" },
      { ai: "no_hire", decision: "reject" },
    ]);
    expect(r).toMatchObject({ n: 4, agree: 2, aiHireRejected: 1, aiNoOffered: 1, rate: 0.5 });
    expect(aiVsDecision([]).rate).toBeNull();
  });
  it("pairwise agreement between panelists", () => {
    const a = panelAgreement([
      {
        competencies: ["Depth", "Comms"],
        cards: [
          { ratings: { Depth: 4, Comms: 3 }, recommendation: "hire" },
          { ratings: { Depth: 2, Comms: 3 }, recommendation: "lean_no" },
          { ratings: { Depth: 4 }, recommendation: "strong_hire" },
        ],
      },
      { competencies: ["Depth"], cards: [{ ratings: { Depth: 5 }, recommendation: "hire" }] }, // one card: ignored
    ]);
    expect(a.interviews).toBe(1);
    // Depth pairs: (4,2) (4,4) (2,4); Comms pairs: (3,3) → 4 pairs, exact 2, within one 2.
    expect(a.ratingPairs).toBe(4);
    expect(a.exact).toBeCloseTo(0.5);
    expect(a.withinOne).toBeCloseTo(0.5);
    // Recommendation pairs: hire/lean_no ✗, hire/strong ✓, lean_no/strong ✗.
    expect(a.recommendationPairs).toBe(3);
    expect(a.sameSide).toBeCloseTo(1 / 3);
    expect(a.meanSpread).toBeCloseTo((2 + 0) / 2);
    expect(panelAgreement([]).withinOne).toBeNull();
  });
  it("normalises recruiter tags", () => {
    expect(normaliseTags([" Silver Medalist ", "silver  medalist", "", "Backend", "x".repeat(31)])).toEqual(["silver medalist", "backend"]);
    expect(normaliseTags(Array.from({ length: 20 }, (_, i) => `t${i}`))).toHaveLength(12);
  });
});
