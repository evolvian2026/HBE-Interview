import { describe, expect, it } from "vitest";
import { APTITUDE_BANK } from "@/lib/content/aptitude";
import { DEFAULT_SCREENING, SECTIONS, bands, buildPaper, configProblems, csvRowsToQuestions, questionProblems, scorePaper } from "@/lib/core/screening";

describe("built-in question bank", () => {
  it("has well-formed questions in every section", () => {
    const ids = new Set<string>();
    for (const q of APTITUDE_BANK) {
      expect(ids.has(q.id)).toBe(false);
      ids.add(q.id);
      expect(questionProblems({ ...q, options: [...q.options] })).toEqual([]);
    }
    for (const s of SECTIONS) expect(APTITUDE_BANK.filter((q) => q.section === s).length).toBeGreaterThanOrEqual(12);
  });
  it("has answers that check out where they can be computed", () => {
    const ans = (id: string) => {
      const q = APTITUDE_BANK.find((x) => x.id === id)!;
      return q.options[q.answer];
    };
    expect(ans("q-train-pole")).toBe(String((150 / 10) * 3.6));
    expect(ans("q-percent-sum")).toBe(String(0.2 * 250 + 0.15 * 400));
    expect(ans("q-work-together")).toBe(String(Math.round((1 / (1 / 12 + 1 / 18)) * 10) / 10));
    expect(ans("q-average-removed")).toBe(String(5 * 24 - 4 * 22));
    expect(ans("q-ratio-class")).toBe(String((40 * 5) / 8));
    expect(ans("q-average-speed")).toBe(`${120 / (60 / 30 + 60 / 60)} km/h`);
    expect(ans("l-series-pronic")).toBe(String(6 * 7));
    expect(ans("l-series-powers")).toBe(String(81 * 3));
    expect(ans("l-fibonacci")).toBe(String(5 + 8));
    expect(ans("l-queue-position")).toBe(String(7 + 12 - 1));
    expect(ans("l-clock-angle")).toBe(`${Math.abs(3 * 30 + 30 * 0.5 - 30 * 6)}°`);
    expect(ans("t-python-floordiv")).toBe(String(Math.floor(7 / 2)));
    expect(ans("t-binary-ten")).toBe((10).toString(2));
  });
});

describe("papers", () => {
  const cfg = { sections: { quant: 3, logical: 2, verbal: 0, technical: 4 } };
  it("draws the right number per section, without duplicates", () => {
    const p = buildPaper(APTITUDE_BANK, cfg, "cand-1");
    expect(p.length).toBe(9);
    expect(p.filter((q) => q.section === "verbal").length).toBe(0);
    expect(new Set(p.map((q) => q.qid)).size).toBe(9);
  });
  it("is reproducible from its seed and differs between candidates", () => {
    expect(buildPaper(APTITUDE_BANK, cfg, "cand-1")).toEqual(buildPaper(APTITUDE_BANK, cfg, "cand-1"));
    expect(buildPaper(APTITUDE_BANK, cfg, "cand-1").map((q) => q.qid)).not.toEqual(buildPaper(APTITUDE_BANK, cfg, "cand-2").map((q) => q.qid));
  });
  it("shuffles options but keeps track of the right one", () => {
    for (const q of buildPaper(APTITUDE_BANK, { sections: { quant: 12, logical: 12, verbal: 12, technical: 12 } }, "x")) {
      const src = APTITUDE_BANK.find((b) => b.id === q.qid)!;
      expect(q.options[q.correct]).toBe(src.options[src.answer]);
      expect([...q.options].sort()).toEqual([...src.options].sort());
    }
  });
});

describe("scoring", () => {
  it("counts correct answers overall and per section", () => {
    const p = buildPaper(APTITUDE_BANK, { sections: { quant: 2, logical: 2, verbal: 0, technical: 0 } }, "s");
    const answers = { [p[0].qid]: p[0].correct, [p[1].qid]: (p[1].correct + 1) % 4, [p[2].qid]: p[2].correct };
    const s = scorePaper(p, answers);
    expect(s).toMatchObject({ correct: 2, total: 4, answered: 3, percent: 50 });
    expect(s.bySection.quant).toEqual({ correct: 1, total: 2 });
    expect(s.bySection.logical).toEqual({ correct: 1, total: 2 });
  });
  it("bands scores for the distribution", () => {
    expect(bands([0, 9.9, 55, 100, 100])).toEqual([2, 0, 0, 0, 0, 1, 0, 0, 0, 2]);
  });
});

describe("configuration and import", () => {
  it("checks the test configuration against the bank", () => {
    expect(configProblems({ ...DEFAULT_SCREENING, enabled: true }, { quant: 12, logical: 12, verbal: 12, technical: 12 })).toEqual([]);
    expect(configProblems({ ...DEFAULT_SCREENING, enabled: true, sections: { quant: 20, logical: 0, verbal: 0, technical: 0 } }, { quant: 12 }).join(" ")).toMatch(/Only 12 quant/);
    expect(configProblems({ ...DEFAULT_SCREENING, enabled: true, sections: { quant: 0, logical: 0, verbal: 0, technical: 0 } }, {}).join(" ")).toMatch(/at least one/);
    expect(configProblems({ ...DEFAULT_SCREENING, durationMin: 2 }, {}).join(" ")).toMatch(/5–180/);
  });
  it("imports questions from CSV with per-row problems", () => {
    const rows = [
      ["section", "question", "a", "b", "c", "d", "answer", "explanation"],
      ["quant", "What is 2 + 2?", "3", "4", "5", "6", "B", "Basic sum"],
      ["logical", "Next: 1, 2, 4, ?", "6", "8", "7", "16", "2", ""],
      ["history", "Who?", "x", "y", "z", "w", "A", ""],
      ["verbal", "Pick one", "same", "same", "c", "d", "C", ""],
    ];
    const r = csvRowsToQuestions(rows);
    expect(r.questions.map((q) => q.answer)).toEqual([1, 1]);
    expect(r.problems.length).toBe(2);
    expect(r.problems[0]).toMatch(/Row 4: Section/);
    expect(csvRowsToQuestions([["q", "x"]]).problems[0]).toMatch(/header/);
  });
});
