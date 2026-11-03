import Link from "next/link";
import { hasRole, requireStaffPage } from "@/lib/auth/staff";
import { listHires, staffChoices } from "@/lib/services/hires";
import { Badge, Card, PageHeader } from "@/components/ui";
import { HireActions } from "@/components/staff/hires";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; tone: "blue" | "green" | "slate" | "amber" }> = {
  offered: { label: "offer made", tone: "blue" },
  joined: { label: "joined", tone: "green" },
  declined: { label: "declined", tone: "slate" },
  left: { label: "left", tone: "amber" },
};
const day = (d: Date | null) => (d ? d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");

export default async function HiresPage() {
  const user = await requireStaffPage("hiring_manager");
  const hires = await listHires(user);
  const canManage = hasRole(user, "recruiter");
  const staff = canManage ? await staffChoices(user.orgId) : [];
  const now = Date.now();
  return (
    <>
      <PageHeader
        title="Hires"
        subtitle="Everyone you made an offer to. Record when they join and who their manager is; the manager rates them at 90 and 180 days, so you can see which interview signals predict success."
        actions={
          canManage ? (
            <Link href="/app/quality" className="rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
              Quality of hire →
            </Link>
          ) : undefined
        }
      />
      <Card>
        {hires.length === 0 ? (
          <p className="text-sm text-slate-600">No offers recorded yet. Hires appear here when a final decision of "offer" is recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Person</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Joined</th>
                  <th className="py-2 pr-3">Manager</th>
                  <th className="py-2 pr-3">Check-ins</th>
                  {canManage && <th className="py-2">Update</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {hires.map((h) => (
                  <tr key={h.id}>
                    <td className="py-2 pr-3 align-top">
                      {h.candidacyId ? (
                        <Link href={`/app/candidates/${h.candidacyId}`} className="font-medium text-brand-600 hover:underline">
                          {h.name}
                        </Link>
                      ) : (
                        <span className="text-slate-600">{h.name}</span>
                      )}
                      <span className="block text-xs text-slate-600">{h.roleTitle}</span>
                    </td>
                    <td className="py-2 pr-3 align-top">
                      <Badge tone={STATUS[h.status].tone}>{STATUS[h.status].label}</Badge>
                      {h.status === "left" && <span className="block text-xs text-slate-600">{`${day(h.leftAt)} · ${h.leftReason === "let_go" ? "let go" : h.leftReason}`}</span>}
                    </td>
                    <td className="py-2 pr-3 align-top">{day(h.joinedAt)}</td>
                    <td className="py-2 pr-3 align-top">{h.manager ?? "—"}</td>
                    <td className="py-2 pr-3 align-top text-xs">
                      {h.reviews.length === 0
                        ? "—"
                        : h.reviews.map((r) => {
                            const mine = r.reviewerId === user.id || user.role === "admin";
                            const open = !r.submittedAt && r.dueAt.getTime() - now <= 14 * 86_400_000;
                            const text = r.submittedAt ? `${r.checkpoint}-day: rated ${r.rating}/5` : `${r.checkpoint}-day: ${r.dueAt.getTime() < now ? "overdue since" : "due"} ${day(r.dueAt)}`;
                            return (
                              <span key={r.id} className="block">
                                {mine && (open || r.submittedAt) ? (
                                  <Link href={`/app/hires/review/${r.id}`} className="text-brand-600 hover:underline">
                                    {text}
                                  </Link>
                                ) : (
                                  text
                                )}
                              </span>
                            );
                          })}
                    </td>
                    {canManage && (
                      <td className="py-2 align-top">
                        <HireActions hireId={h.id} status={h.status} staff={staff} managerId={h.managerId} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
