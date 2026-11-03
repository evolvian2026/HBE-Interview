import { describe, expect, it } from "vitest";
import { MIN_HIRES, dueDate, qualityStats, spearman, strength, strengthText, type HireOutcome } from "@/lib/core/quality";

const o = (final: number | null, rating: number | null, over: Partial<HireOutcome> = {}, rec: HireOutcome["snapshot"]["aiRecommendation"] = "hire"): HireOutcome => ({
  snapshot: { finalScore: final, aiRecommendation: rec, roundScores: final == null ? {} : { technical: final }, panelHireShare: null },
  rating,
  wouldRehire: rating == null ? null : rating >= 4 ? "yes" : "no",
  leftEarly: false,
  joined: true,
  ...over,
});

describe("rank correlation", () => {
  it("is 1 for the same order, -1 for the reverse and handles ties", () => {
    expect(spearman([[1, 10], [2, 20], [3, 30], [4, 40]])).toBe(1);
    expect(spearman([[1, 4], [2, 3], [3, 2], [4, 1]])).toBe(-1);
    expect(spearman([[1, 2], [2, 2], [3, 3], [4, 3]])).toBeCloseTo(0.89, 2);
  });
  it("is undefined with too few pairs or no spread", () => {
    expect(spearman([[1, 1], [2, 2]])).toBeNull();
    expect(spearman([[1, 3], [2, 3], [3, 3]])).toBeNull();
  });
  it("labels strength only with enough hires", () => {
    expect(strength(0.9, MIN_HIRES - 1)).toBe("too_few");
    expect(strength(0.05, MIN_HIRES)).toBe("none");
    expect(strength(-0.2, MIN_HIRES)).toBe("weak");
    expect(strength(0.4, MIN_HIRES)).toBe("moderate");
    expect(strength(0.7, 30)).toBe("strong");
  });
});

describe("quality of hire", () => {
  it("relates interview scores to later ratings", () => {
    const hires = Array.from({ length: 12 }, (_, i) => o(50 + i * 4, i < 4 ? 2 : i < 8 ? 3 : 5));
    const s = qualityStats(hires);
    const final = s.predictors.find((p) => p.key === "final")!;
    expect(s.tooEarly).toBe(false);
    expect(final.n).toBe(12);
    expect(final.rho).toBeGreaterThan(0.8);
    expect(final.strength).toBe("strong");
    expect(final.topHalf!).toBeGreaterThan(final.bottomHalf!);
    expect(strengthText(final)).toMatch(/higher scores went with better ratings/);
    expect(s.predictors.find((p) => p.key === "managerial")).toBeUndefined();
  });
  it("summarises outcomes by AI recommendation, rehire and early attrition", () => {
    const s = qualityStats([
      o(80, 5, {}, "strong_hire"),
      o(75, 4, {}, "hire"),
      o(70, 2, {}, "hire"),
      o(55, null, { leftEarly: true }),
      o(60, null, { joined: false }),
    ]);
    expect(s.hires).toBe(5);
    expect(s.joined).toBe(4);
    expect(s.rated).toBe(3);
    expect(s.earlyAttrition).toBe(0.25);
    expect(s.rehireShare).toBeCloseTo(2 / 3);
    expect(s.byRecommendation.find((r) => r.recommendation === "hire")).toMatchObject({ n: 2, avgRating: 3, rehire: 0.5 });
    expect(s.tooEarly).toBe(true);
  });
  it("schedules reviews from the joining date", () => {
    expect(dueDate(new Date("2026-01-01T00:00:00Z"), 90).toISOString().slice(0, 10)).toBe("2026-04-01");
  });
});
