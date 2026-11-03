import { requireStaff } from "@/lib/auth/staff";
import { handle } from "@/lib/http";
import { audit } from "@/lib/audit";
import { csvCell } from "@/lib/csv";
import { driveScreening } from "@/lib/services/screening";
import { SECTIONS } from "@/lib/core/screening";

/** Screening results for a drive: one row per candidate, with section scores and college. */
export const GET = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("recruiter");
  const { id } = await params;
  const r = await driveScreening(user, id);
  const head = ["name", "email", "college", "percent", "result", ...SECTIONS.map((s) => `${s}_correct`), ...SECTIONS.map((s) => `${s}_total`), "minutes", "left_tab"];
  const rows = r.results.map((x) => [x.name, x.email, x.college, x.percent, x.passed ? "passed" : x.reviewStatus === "pending" ? "review" : "not passed", ...SECTIONS.map((s) => x.score?.bySection[s]?.correct ?? ""), ...SECTIONS.map((s) => x.score?.bySection[s]?.total ?? ""), x.minutes, x.focusLosses].map(csvCell).join(","));
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "screening.export", "drive", id, { rows: rows.length });
  return new Response([head.join(","), ...rows].join("\n") + "\n", { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="screening-${id.slice(0, 8)}.csv"`, "cache-control": "no-store" } });
});
