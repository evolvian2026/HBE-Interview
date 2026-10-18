import { requireStaff } from "@/lib/auth/staff";
import { handle } from "@/lib/http";
import { audit } from "@/lib/audit";
import { csvCell } from "@/lib/csv";
import { hiringInsights } from "@/lib/services/insights";

/** One row per candidacy in the period: source, milestones, AI result and decision (no names or emails). */
export const GET = handle(async (req: Request) => {
  const user = await requireStaff("recruiter");
  const p = new URL(req.url).searchParams;
  const days = Math.min(730, Math.max(1, Number(p.get("days") ?? 90) || 90));
  const { rows } = await hiringInsights(user, { days, driveId: p.get("drive") ?? undefined });
  const cols = ["candidacyId", "drive", "source", "stage", "invitedAt", "consentedAt", "aiCompletedAt", "aiRecommendation", "aiScore", "panel", "decision", "decidedAt", "daysToDecision"] as const;
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n") + "\n";
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "insights.export", "insights", null, { days, rows: rows.length });
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="hbe-hiring-insights-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" } });
});
