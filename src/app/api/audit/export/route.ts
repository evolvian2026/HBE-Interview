import { requireStaff } from "@/lib/auth/staff";
import { handle } from "@/lib/http";
import { audit } from "@/lib/audit";
import { auditCsv } from "@/lib/services/audit-log";

/** CSV of the organisation's audit trail with the same filters as the Audit log page (admins). */
export const GET = handle(async (req: Request) => {
  const user = await requireStaff("admin");
  const p = new URL(req.url).searchParams;
  const days = p.get("days") === "all" ? null : Number(p.get("days") ?? 30) || 30;
  const csv = await auditCsv(user.orgId, { category: p.get("category") ?? undefined, actorId: p.get("actor") ?? undefined, days, q: p.get("q") ?? undefined });
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "settings.audit_export", "audit_log", null, { days, category: p.get("category") });
  return new Response(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="hbe-audit-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" },
  });
});
