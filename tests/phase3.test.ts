import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { cohortStats, meanRating } from "@/lib/core/fairness";
import { isInternalHost, signPayload } from "@/lib/core/webhook-sign";
import { API_SCOPES, WEBHOOK_EVENTS } from "@/lib/integrations-shared";

const obs = (cohort: string, pass: number, fail: number, score = 60) => [
  ...Array.from({ length: pass }, () => ({ cohort, passed: true, score })),
  ...Array.from({ length: fail }, () => ({ cohort, passed: false, score })),
];

describe("fairness — four-fifths impact ratio", () => {
  it("flags a cohort whose pass rate is below 80% of the best cohort", () => {
    const s = cohortStats([...obs("Text", 6, 4), ...obs("Voice", 4, 6)]);
    const text = s.find((x) => x.cohort === "Text")!;
    const voice = s.find((x) => x.cohort === "Voice")!;
    expect(text.passRate).toBeCloseTo(0.6);
    expect(text.impactRatio).toBeCloseTo(1);
    expect(voice.impactRatio).toBeCloseTo(0.667, 2);
    expect(voice.flagged).toBe(true);
    expect(text.flagged).toBe(false);
  });
  it("does not compare cohorts below the minimum size, or when only one cohort is comparable", () => {
    const s = cohortStats([...obs("English", 5, 5), ...obs("Hindi", 0, 3)]);
    const hi = s.find((x) => x.cohort === "Hindi")!;
    expect(hi.small).toBe(true);
    expect(hi.impactRatio).toBeNull();
    expect(hi.flagged).toBe(false);
    expect(s.find((x) => x.cohort === "English")!.impactRatio).toBeNull();
  });
  it("handles zero passes everywhere and computes mean scores", () => {
    const s = cohortStats([...obs("A", 0, 5, 40), ...obs("B", 0, 5, 50)]);
    expect(s.every((x) => x.impactRatio == null && !x.flagged)).toBe(true);
    expect(s.find((x) => x.cohort === "B")!.meanScore).toBe(50);
  });
  it("averages ratings ignoring blanks", () => {
    expect(meanRating([5, null, 3, undefined])).toBe(4);
    expect(meanRating([])).toBeNull();
  });
});

describe("webhooks", () => {
  it("signs timestamp.body with HMAC-SHA256 exactly as documented", () => {
    const body = JSON.stringify({ id: "d1", event: "ping" });
    const expected = "sha256=" + createHmac("sha256", "whsec_test").update(`1760601600.${body}`).digest("hex");
    expect(signPayload("whsec_test", "1760601600", body)).toBe(expected);
    expect(signPayload("whsec_other", "1760601600", body)).not.toBe(expected);
  });
  it("blocks internal targets and allows public ones", () => {
    for (const h of ["localhost", "127.0.0.1", "10.2.3.4", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "[::1]", "fd12:3456::1", "fe80::1", "metadata.google.internal", "db.internal", "printer.local"])
      expect(isInternalHost(h), h).toBe(true);
    for (const h of ["hooks.example.com", "8.8.8.8", "172.32.0.1", "100.128.0.1", "2606:4700::1111"]) expect(isInternalHost(h), h).toBe(false);
  });
  it("exposes stable scope and event names", () => {
    expect(API_SCOPES).toEqual(["drives:read", "candidates:read", "candidates:write"]);
    expect(WEBHOOK_EVENTS).toContain("round.evaluated");
  });
});
