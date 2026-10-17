import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/auth/staff";
import { failedJobs, lastWorkerHeartbeat, queueStats } from "@/lib/services/ops";
import { Badge, Card, PageHeader } from "@/components/ui";
import { StatTile } from "@/components/charts";
import { JobActions } from "@/components/staff/job-actions";

export const dynamic = "force-dynamic";

const ago = (sec: number | null | undefined) => (sec == null ? "—" : sec < 90 ? `${sec}s` : sec < 5400 ? `${Math.round(sec / 60)} min` : `${Math.round(sec / 3600)} h`);
const STATUSES = ["queued", "running", "done", "failed"] as const;

export default async function OpsPage() {
  const user = await requireStaffPage();
  if (!user.platformAdmin) notFound();
  const [hb, q, failed] = await Promise.all([lastWorkerHeartbeat(), queueStats(), failedJobs()]);
  const types = [...new Set(q.byType.map((r) => r.type))].sort();
  const cell = (type: string, status: string) => q.byType.find((r) => r.type === type && r.status === status)?.n ?? 0;
  const healthy = hb != null && hb.ageSec < 120;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Operations"
        subtitle={
          <Link href="/app/platform" className="text-brand-600 hover:underline">
            ← Platform
          </Link>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Job worker" value={healthy ? "Running" : "Not seen"} sub={hb ? `heartbeat ${ago(hb.ageSec)} ago` : "no heartbeat recorded"} />
        <StatTile label="Due now" value={String(q.due)} sub={`${q.queued} queued in total`} />
        <StatTile label="Oldest waiting" value={ago(q.oldestDueSec)} sub="alert above 5 min" />
        <StatTile label="Running" value={String(q.running)} />
        <StatTile label="Retrying" value={String(q.retrying)} sub="failed once, will retry" />
        <StatTile label="Failed (24 h)" value={String(q.failed24h)} sub="after all retries" />
      </div>
      <Card title="Jobs by type (last 7 days and everything pending)">
        {types.length === 0 ? (
          <p className="text-sm text-slate-500">No jobs.</p>
        ) : (
          <table className="w-full text-sm tabular-nums">
            <caption className="sr-only">Job counts by type and status</caption>
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2">Type</th>
                {STATUSES.map((s) => (
                  <th key={s} className="text-right">
                    {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {types.map((t) => (
                <tr key={t}>
                  <td className="py-1.5 font-mono text-xs">{t}</td>
                  {STATUSES.map((s) => (
                    <td key={s} className={`text-right ${s === "failed" && cell(t, s) ? "font-semibold text-red-700" : ""}`}>
                      {cell(t, s)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card title={`Failed jobs (${failed.length})`}>
        {failed.length === 0 ? (
          <p className="text-sm text-slate-500">No failed jobs.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {failed.map((j) => (
              <li key={j.id} className="flex flex-wrap items-start justify-between gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p>
                    <Badge tone="red">{j.type}</Badge> <span className="text-xs text-slate-500">{`#${j.id} · ${j.attempts}/${j.maxAttempts} attempts · ${j.updatedAt.toLocaleString()}`}</span>
                  </p>
                  <p className="mt-1 truncate font-mono text-xs text-slate-600" title={j.lastError ?? ""}>
                    {(j.lastError ?? "").split("\n")[0]}
                  </p>
                  <p className="truncate font-mono text-xs text-slate-500">{JSON.stringify(j.payload)}</p>
                </div>
                <JobActions id={j.id} />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-slate-500">Completed jobs are kept 7 days and failed jobs 30 days. Uptime monitors can poll /api/health (worker heartbeat and queue lag).</p>
      </Card>
    </div>
  );
}
