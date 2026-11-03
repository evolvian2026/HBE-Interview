import { Badge } from "../ui";
import type { Verdict } from "@/lib/core/benchmark";

const V: Record<Verdict, { label: string; tone: "green" | "amber" | "red" }> = {
  pass: { label: "✓ In line with your team", tone: "green" },
  review: { label: "! Needs a look", tone: "amber" },
  fail: { label: "✕ Not in line", tone: "red" },
};

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return <Badge tone={V[verdict].tone}>{V[verdict].label}</Badge>;
}
