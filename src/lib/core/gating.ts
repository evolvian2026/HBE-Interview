import { recRank } from "./scoring";
import type { GateConfig, Recommendation } from "./types";

export type GateOutcome = "advance" | "pending";

/** Decide what happens after a round's report is ready (PRD §3.2). */
export function evaluateGate(gate: GateConfig, recommendation: Recommendation): GateOutcome {
  if (gate.mode === "always") return "advance";
  if (gate.mode === "manual") return "pending";
  return recRank(recommendation) >= recRank(gate.threshold) ? "advance" : "pending";
}
