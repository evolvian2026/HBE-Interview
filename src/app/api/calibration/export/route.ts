import { requireStaff } from "@/lib/auth/staff";
import { handle } from "@/lib/http";
import { audit } from "@/lib/audit";
import { csvCell } from "@/lib/csv";
import { calibrationReviews } from "@/lib/services/calibration";
import type { RoundType } from "@/lib/core/types";

/** CSV of calibration reviews (one row per parameter scored) with the Calibration page's filters. Admins and recruiters. */
export const GET = handle(async (req: Request) => {
  const user = await requireStaff("recruiter");
  const p = new URL(req.url).searchParams;
  const days = Math.min(730, Math.max(1, Number(p.get("days") ?? 90) || 90));
  const roundType = (["technical", "managerial", "hr"] as const).find((t) => t === p.get("round")) as RoundType | undefined;
  const rows = await calibrationReviews(user, { days, driveId: p.get("drive") ?? undefined, roundType, includeNonBlind: p.get("all") === "1" });
  const lines = [["reviewed_at", "drive", "round", "candidacy_id", "reviewer", "blind", "parameter", "human_score", "ai_score", "human_recommendation", "ai_recommendation", "evaluator", "prompt", "disagrees"].join(",")];
  for (const { r, reviewer, driveTitle } of rows)
    for (const [param, h] of Object.entries(r.scores))
      lines.push(
        [r.createdAt.toISOString(), driveTitle, r.roundType, r.candidacyId, reviewer ?? "", r.blind, param, h, r.ai.scores[param] ?? "", r.recommendation, r.ai.recommendation, r.ai.evaluator, r.ai.prompt, r.disagrees].map((v) => csvCell(String(v))).join(","),
      );
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "calibration.export", "calibration", null, { days, roundType });
  return new Response(lines.join("\n") + "\n", {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="hbe-calibration-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" },
  });
});
