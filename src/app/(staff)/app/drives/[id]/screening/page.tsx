import Link from "next/link";
import { notFound } from "next/navigation";
import { HttpError, requireStaffPage } from "@/lib/auth/staff";
import { driveScreening } from "@/lib/services/screening";
import { SECTION_LABEL } from "@/lib/content/aptitude";
import { SECTIONS } from "@/lib/core/screening";
import { Badge, Card, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);

export default async function DriveScreeningPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaffPage("hiring_manager");
  const { id } = await params;
  const r = await driveScreening(user, id).catch((e) => {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  });
  const maxBand = Math.max(1, ...r.bands);
  return (
    <>
      <Link href={`/app/drives/${id}`} className="text-sm text-brand-600 hover:underline">
        ← {r.drive.title}
      </Link>
      <PageHeader
        title="Screening test results"
        subtitle={`${r.submitted} submitted · ${r.inProgress} in progress · ${r.passed} passed${r.pending ? ` · ${r.pending} waiting for a decision` : ""}`}
        actions={
          <a href={`/api/drives/${id}/screening/export`} className="rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
            Export CSV
          </a>
        }
      />
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card title="Scores">
          <p className="text-sm">{`Average ${r.avg ?? "—"}% · pass rate ${r.submitted ? pct(r.passed / r.submitted) : "—"}`}</p>
          <div className="mt-3 flex h-28 items-end gap-1" role="img" aria-label={`Score distribution: ${r.bands.map((n, i) => `${i * 10}–${i === 9 ? 100 : i * 10 + 9}%: ${n}`).join(", ")}`}>
            {r.bands.map((n, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1">
                <div className="w-full rounded-t bg-brand-600" style={{ height: `${(n / maxBand) * 88}px` }} title={`${n}`} />
                <span className="text-[10px] text-slate-600">{i * 10}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Average by section" className="lg:col-span-2">
          <ul className="space-y-2 text-sm">
            {SECTIONS.filter((s) => r.sectionAvg[s] != null).map((s) => (
              <li key={s} className="flex items-center gap-3">
                <span className="w-48">{SECTION_LABEL[s]}</span>
                <span className="h-2 flex-1 rounded-full bg-slate-200" aria-hidden="true">
                  <span className="block h-2 rounded-full bg-brand-600" style={{ width: `${r.sectionAvg[s]}%` }} />
                </span>
                <span className="w-14 text-right">{`${r.sectionAvg[s]}%`}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Card title="By college" className="mb-6">
        {r.byCollege.length === 0 ? (
          <p className="text-sm text-slate-600">No results yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 pr-3">College</th>
                <th className="py-2 pr-3">Took the test</th>
                <th className="py-2 pr-3">Average</th>
                <th className="py-2 pr-3">Passed</th>
                <th className="py-2">Top score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {r.byCollege.map((c) => (
                <tr key={c.college}>
                  <td className="py-2 pr-3">{c.college === "—" ? "Not given" : c.college}</td>
                  <td className="py-2 pr-3">{c.n}</td>
                  <td className="py-2 pr-3">{`${c.avg}%`}</td>
                  <td className="py-2 pr-3">{pct(c.passRate)}</td>
                  <td className="py-2">{`${c.top}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card title="Candidates (highest first)">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 pr-3">Candidate</th>
                <th className="py-2 pr-3">College</th>
                <th className="py-2 pr-3">Score</th>
                {SECTIONS.map((s) => (
                  <th key={s} className="py-2 pr-3">
                    {s}
                  </th>
                ))}
                <th className="py-2 pr-3">Time</th>
                <th className="py-2">Left the tab</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {r.results.map((x) => (
                <tr key={x.candidacyId}>
                  <td className="py-2 pr-3">
                    <Link href={`/app/candidates/${x.candidacyId}`} className="font-medium text-brand-600 hover:underline">
                      {x.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-3">{x.college ?? "—"}</td>
                  <td className="py-2 pr-3">
                    {`${x.percent}% `}
                    {x.passed ? <Badge tone="green">passed</Badge> : x.reviewStatus === "pending" ? <Badge tone="amber">decide</Badge> : <Badge>not passed</Badge>}
                  </td>
                  {SECTIONS.map((s) => (
                    <td key={s} className="py-2 pr-3">
                      {x.score?.bySection[s] ? `${x.score.bySection[s]!.correct}/${x.score.bySection[s]!.total}` : "—"}
                    </td>
                  ))}
                  <td className="py-2 pr-3">{x.minutes == null ? "—" : x.minutes < 1 ? "<1 min" : `${x.minutes} min`}</td>
                  <td className="py-2">{x.focusLosses ? `${x.focusLosses}×` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
