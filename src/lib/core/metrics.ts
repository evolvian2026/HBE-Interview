/** Pure helpers for analytics and AI cost reporting. */

export function bins10(values: number[]) {
  const out = Array.from({ length: 10 }, (_, i) => ({ label: `${i * 10}–${i * 10 + 9}`, count: 0 }));
  out[9].label = "90–100";
  for (const v of values) out[Math.min(9, Math.max(0, Math.floor(v / 10)))].count++;
  return out;
}

/** USD per million tokens (input, output, cache read). Estimates for reporting; update when pricing changes. */
export const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

export function estimateCost(model: string, t: { input: number; output: number; cacheRead: number; cacheWrite: number }) {
  const p = PRICES[model] ?? PRICES["claude-sonnet-5-5"];
  // Cache writes are billed at 1.25× the input rate (5-minute TTL).
  return (t.input * p.input + t.output * p.output + t.cacheRead * p.cacheRead + t.cacheWrite * p.input * 1.25) / 1_000_000;
}

