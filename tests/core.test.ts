import { describe, expect, it } from "vitest";
import { buildDefaultDriveConfig, enabledRounds, validateDriveConfig } from "@/lib/core/rounds";
import { band, finalResult, median, roundKnockouts, roundRecommendation, roundScore, runsDisagree } from "@/lib/core/scoring";
import { evaluateGate } from "@/lib/core/gating";
import { checkCompatibility, emptyPracticalFit } from "@/lib/core/practical-fit";
import { computeSignals } from "@/lib/core/authenticity";
import { quoteMatches } from "@/lib/core/evidence";
import {
  advanceSection,
  applyAssessment,
  checkAdvance,
  initState,
  jumpToWrapUp,
  openExercise,
  recordAiTurn,
  startFirstSection,
  submitExercise,
  endPause,
  startPause,
} from "@/lib/core/interview";
import { paramIds } from "@/lib/core/rubrics";
import type { ParamScore, RoleProfile } from "@/lib/core/types";

const profile = (over: Partial<RoleProfile> = {}): RoleProfile => ({
  category: "coding",
  seniority: "mid",
  track: "ic",
  mustHaveSkills: ["Node.js"],
  niceToHaveSkills: [],
  responsibilities: [],
  leadershipExpectations: [],
  domain: "fintech",
  summary: "",
  ...over,
});
const JD = "x".repeat(250);

const p = (score: number | null, n = 2): ParamScore => ({
  score,
  justification: "",
  evidence: Array.from({ length: n }, () => ({ type: "transcript" as const, ref: "m1", quote: "q" })),
  confidence: "high",
});

describe("round matrix", () => {
  it("enables Managerial only for senior+ and keeps HR last", () => {
    const junior = buildDefaultDriveConfig("t", JD, profile({ seniority: "junior" }));
    expect(enabledRounds(junior).map((r) => r.type)).toEqual(["technical", "hr"]);
    const mgr = buildDefaultDriveConfig("t", JD, profile({ seniority: "manager", track: "manager" }));
    expect(enabledRounds(mgr).map((r) => r.type)).toEqual(["technical", "managerial", "hr"]);
    expect(mgr.roundWeights).toEqual({ technical: 35, managerial: 45, hr: 20 });
  });

  it("produces a valid default config with coding + system design for senior coders", () => {
    const c = buildDefaultDriveConfig("Senior Backend", JD, profile({ seniority: "senior" }));
    expect(validateDriveConfig(c)).toEqual([]);
    const keys = c.rounds[0].sections.map((s) => s.key);
    expect(keys).toContain("system_design");
    expect(keys).toContain("coding");
  });

  it("non-technical roles get a domain case and no coding", () => {
    const c = buildDefaultDriveConfig("Sales", JD, profile({ category: "non_technical" }));
    const keys = c.rounds[0].sections.map((s) => s.key);
    expect(keys).toContain("domain_case");
    expect(keys).not.toContain("coding");
    expect(c.rounds[0].weights.code_quality).toBe(0);
  });
});

describe("scoring", () => {
  const cfg = buildDefaultDriveConfig("t", JD, profile());
  it("computes weighted round score and redistributes unassessed weight", () => {
    const w = { a: 50, b: 50 };
    expect(roundScore({ a: p(5), b: p(3) }, w)).toBe(80);
    expect(roundScore({ a: p(4), b: p(null) }, w)).toBe(80);
  });
  it("bands", () => {
    expect(band(80, cfg.bands)).toBe("strong_hire");
    expect(band(65, cfg.bands)).toBe("hire");
    expect(band(64.9, cfg.bands)).toBe("lean_no");
    expect(band(10, cfg.bands)).toBe("no_hire");
  });
  it("applies authenticity knockout", () => {
    const params = { role_fit: p(5), authenticity: p(2), code_quality: p(5), problem_solving: p(5), communication: p(5) };
    const k = roundKnockouts("technical", params, cfg);
    expect(k).toHaveLength(1);
    expect(roundRecommendation(roundScore(params, cfg.rounds[0].weights), k, cfg)).toBe("lean_no");
  });
  it("override changes the effective score", () => {
    const params = { a: { ...p(2), override: { score: 4, reason: "r", by: "u", at: "" } } };
    expect(roundScore(params, { a: 100 })).toBe(80);
  });
  it("median and disagreement", () => {
    expect(median([2, 4, 3])).toBe(3);
    expect(median([2, 4])).toBe(3);
    expect(runsDisagree({ a: 2 }, { a: 4 })).toBe(true);
    expect(runsDisagree({ a: 3 }, { a: 4 })).toBe(false);
  });
  it("final result renormalises and caps on No Hire", () => {
    const r = finalResult(
      cfg,
      [
        { type: "technical", score: 90, recommendation: "strong_hire", knockouts: [] },
        { type: "hr", score: 40, recommendation: "no_hire", knockouts: [] },
      ],
      ["technical", "hr"],
    );
    expect(r.finalScore).toBeCloseTo((90 * 70 + 40 * 30) / 100, 1);
    expect(r.recommendation).toBe("lean_no");
    expect(r.partial).toBe(false);
  });
});

describe("gating", () => {
  it("auto-advances at or above threshold", () => {
    expect(evaluateGate({ mode: "auto", threshold: "hire" }, "hire")).toBe("advance");
    expect(evaluateGate({ mode: "auto", threshold: "hire" }, "lean_no")).toBe("pending");
    expect(evaluateGate({ mode: "manual", threshold: "hire" }, "strong_hire")).toBe("pending");
    expect(evaluateGate({ mode: "always", threshold: "hire" }, "no_hire")).toBe("advance");
  });
});

describe("practical fit", () => {
  it("computes per-field and overall status", () => {
    const d = { ...emptyPracticalFit(), currentLocation: "Pune", willingToRelocate: "depends" as const, workModel: "hybrid" as const, noticeDays: 75, expectedCompMin: 20, expectedCompMax: 25 };
    const c = checkCompatibility(
      d,
      { currency: "INR", budgetMin: 10, budgetMax: 18, maxNoticeDays: 60, locations: ["Bengaluru"], workModels: ["hybrid"], relocationSupport: true },
      { askCompensation: true },
    );
    const by = Object.fromEntries(c.fields.map((f) => [f.field, f.status]));
    expect(by).toEqual({ compensation: "negotiable", notice: "negotiable", location: "negotiable", workModel: "match" });
    expect(c.overall).toBe("negotiable");
  });
  it("omits compensation when the policy is off", () => {
    const c = checkCompatibility(emptyPracticalFit(), { currency: "INR", budgetMin: 1, budgetMax: 2, maxNoticeDays: null, locations: [], workModels: [], relocationSupport: false }, { askCompensation: false });
    expect(c.fields).toHaveLength(0);
  });
});

describe("authenticity signals", () => {
  it("flags fork with few own commits and bulk upload", () => {
    const r = computeSignals({
      fullName: "a/b", fork: true, parentFullName: "x/y", createdAt: "2026-01-01", pushedAt: "2026-01-02", sizeKb: 10,
      languages: {}, sourceFileCount: 10, totalCommits: 10, candidateCommits: 2, activeDays: 1, largestCommitShare: 0.95,
    });
    expect(r.overall).toBe("high");
  });
});

describe("evidence verification", () => {
  it("matches exact and near-exact quotes, rejects invented ones", () => {
    const src = "I used Redis as a write-through cache, which cut p99 latency from 800ms to 120ms.";
    expect(quoteMatches("used Redis as a write-through cache", src)).toBe(true);
    expect(quoteMatches("I used redis as a write through cache which cut p99 latency", src)).toBe(true);
    expect(quoteMatches("I built a Kafka pipeline for payments", src)).toBe(false);
  });
});

describe("interview state machine", () => {
  const cfg = buildDefaultDriveConfig("t", JD, profile());
  const round = cfg.rounds[0];
  const t0 = new Date("2026-01-01T10:00:00Z");
  const at = (sec: number) => new Date(t0.getTime() + sec * 1000);

  it("blocks early agent advance until minQ, then allows it", () => {
    let s = startFirstSection(initState(round, paramIds("technical")), t0);
    s = { ...s, sections: s.sections.map((x, i) => (i === 0 ? { ...x, minQ: 2, maxQ: 5 } : x)) };
    expect(checkAdvance(s, at(10), { agentRequested: true }).advance).toBe(false);
    s = recordAiTurn(recordAiTurn(s));
    expect(checkAdvance(s, at(20), { agentRequested: true })).toMatchObject({ advance: true, reason: "agent" });
  });

  it("advances on time budget and at maxQ", () => {
    const s = startFirstSection(initState(round, paramIds("technical")), t0);
    expect(checkAdvance(s, at(round.sections[0].minutes * 60 + 1)).advance).toBe(true);
    let s2 = s;
    for (let i = 0; i < s.sections[0].maxQ; i++) s2 = recordAiTurn(s2);
    expect(checkAdvance(s2, at(5))).toMatchObject({ advance: true, reason: "max_questions" });
  });

  it("does not allow closing an unsubmitted coding exercise early", () => {
    let s = startFirstSection(initState(round, paramIds("technical")), t0);
    const codingIdx = s.sections.findIndex((x) => x.key === "coding");
    while (s.current < codingIdx) s = advanceSection(s, t0);
    s = openExercise(s, "coding", "p1", t0);
    for (let i = 0; i < 12; i++) s = recordAiTurn(s);
    expect(checkAdvance(s, at(30), { agentRequested: true }).advance).toBe(false);
    s = submitExercise(s, "coding", at(40));
    expect(checkAdvance(s, at(41), { agentRequested: true }).advance).toBe(true);
  });

  it("moves on after repeated weak follow-ups", () => {
    let s = startFirstSection(initState(round, paramIds("technical")), t0);
    let moveOn = false;
    for (let i = 0; i < 3; i++) ({ state: s, moveOn } = applyAssessment(s, { parameter: "role_fit", score: 1, needsFollowUp: true }));
    expect(moveOn).toBe(true);
    expect(s.coverage.role_fit.struggled).toBe(true);
  });

  it("jumps to wrap-up and ends after the last section", () => {
    let s = startFirstSection(initState(round, paramIds("technical")), t0);
    s = jumpToWrapUp(s, t0);
    expect(s.sections[s.current].key).toBe("wrapup");
    s = advanceSection(s, t0);
    expect(s.ended).toBe(true);
  });

  it("pause extends the section clock and is limited", () => {
    let s = startFirstSection(initState(round, paramIds("technical")), t0);
    s = startPause(s, at(10)).state;
    const r = endPause(s, at(70));
    expect(r.pausedSec).toBe(60);
    expect(Date.parse(r.state.sections[0].startedAt!)).toBe(t0.getTime() + 60_000);
    s = startPause(r.state, at(80)).state;
    s = endPause(s, at(90)).state;
    expect(startPause(s, at(100)).error).toBeTruthy();
  });
});
