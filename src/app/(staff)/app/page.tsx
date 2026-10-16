import Link from "next/link";
import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { listDrives } from "@/lib/services/drives";
import { requireStaffPage, hasRole, canSeeDrive } from "@/lib/auth/staff";
import { Badge, Card, Empty, LinkButton, PageHeader } from "@/components/ui";
import { SENIORITY_LABEL, type DriveConfig } from "@/lib/core/types";

export const dynamic = "force-dynamic";

const STATUS_TONE = { draft: "slate", active: "green", paused: "amber", closed: "slate" } as const;

export default async function DrivesPage() {
  const user = await requireStaffPage();
  const drives = (await listDrives()).filter((d) => canSeeDrive(user, d.id));
  const [{ n: pending }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.candidacies).where(sql`${schema.candidacies.stage} = 'gate_pending'`);
  return (
    <>
      <PageHeader
        title="Hiring drives"
        subtitle="Each drive is an AI interview process for one role."
        actions={hasRole(user, "recruiter") && <LinkButton href="/app/drives/new">New hiring drive</LinkButton>}
      />
      {pending > 0 && (
        <Link href="/app/gate-queue" className="mb-6 block rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100">
          <b>{pending}</b> candidate{pending > 1 ? "s are" : " is"} waiting for a decision before their next round →
        </Link>
      )}
      {drives.length === 0 ? (
        <Empty>No hiring drives yet. Create one from a job description to get started.</Empty>
      ) : (
        <Card className="overflow-hidden">
          <div className="-m-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Drive</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Seniority</th>
                  <th className="px-3 py-3 text-right">Candidates</th>
                  <th className="px-3 py-3 text-right">In progress</th>
                  <th className="px-3 py-3 text-right">Awaiting decision</th>
                  <th className="px-3 py-3 text-right">Completed</th>
                  <th className="px-5 py-3 text-right">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {drives.map((d) => {
                  const cfg = d.draft as DriveConfig;
                  const s = d.byStage;
                  const inProg = (s.onboarding ?? 0) + (s.ready ?? 0) + (s.in_round ?? 0) + (s.evaluating ?? 0) + (s.round_available ?? 0);
                  return (
                    <tr key={d.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <Link href={`/app/drives/${d.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                          {d.title}
                        </Link>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={STATUS_TONE[d.status]}>{d.status}</Badge>
                      </td>
                      <td className="px-3 py-3 text-slate-600">{SENIORITY_LABEL[cfg.roleProfile.seniority]}</td>
                      <td className="px-3 py-3 text-right">{d.total}</td>
                      <td className="px-3 py-3 text-right">{inProg}</td>
                      <td className="px-3 py-3 text-right">{s.gate_pending ?? 0}</td>
                      <td className="px-3 py-3 text-right">{(s.completed ?? 0) + (s.shortlisted ?? 0)}</td>
                      <td className="px-5 py-3 text-right text-slate-500">{d.updatedAt.toLocaleDateString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
