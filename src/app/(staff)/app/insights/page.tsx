import Link from "next/link";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireStaffPage } from "@/lib/auth/staff";
import { hiringInsights } from "@/lib/services/insights";
import { RECOMMENDATION_LABEL } from "@/lib/core/types";
import { Card, PageHeader, Select, cx } from "@/components/ui";
import { BarList, StatTile } from "@/components/charts";

export const dynamic = "force-dynamic";

const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const d1 = (x: number | null) => (x == null ? "—" : `${x < 10 ? x.toFixed(1) : Math.round(x)} days`);

export default async function InsightsPage({ searchParams }: { searchParams: Promise<{ days?: string; drive?: string }> }) {
  const user = await requireStaffPage("recruiter");
  const sp = await searchParams;
  const period = [30, 90, 180, 365].includes(Number(sp.days)) ? Number(sp.days) : 90;
  const ins = await hiringInsights(user, { days: period, driveId: sp.drive || undefined });
  const drives = await db.select({ id: schema.drives.id, title: schema.drives.title }).from(schema.drives).where(eq(schema.drives.orgId, user.orgId));
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams({ days: String(period), ...(sp.drive ? { drive: sp.drive } : {}), ...patch } as Record<string, string>);
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return `/app/insights?${p}`;
  };
  return (
    <>
      <PageHeader
        title="Hiring insights"
        subtitle={`Candidates who started in the last ${period} days${sp.drive ? ` on ${drives.find((d) => d.id === sp.drive)?.title ?? "one drive"}` : ", all drives"}: how far they got, how long it took, where they came from, and how people's decisions compare with the AI.`}
        actions={
          <a href={`/api/insights/export?days=${period}${sp.drive ? `&drive=${sp.drive}` : ""}`} className="rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
            Export CSV
          </a>
        }
      />
      <nav aria-label="Filters" className="mb-6 flex flex-wrap items-center gap-2 text-sm">
        {[30, 90, 180, 365].map((n) => (
          <Link key={n} href={qs({ days: String(n) })} aria-current={n === period ? "page" : undefined} className={cx("rounded-full px-3 py-1", n === period ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700")}>
            {n} days
          </Link>
        ))}
        <form className="ml-2 flex items-center gap-2">
          <input type="hidden" name="days" value={period} />
          <label className="flex items-center gap-2">
            <span className="text-slate-600">Drive</span>
            <Select name="drive" defaultValue={sp.drive ?? ""}>
              <option value="">All drives</option>
              {drives.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </Select>
          </label>
          <button type="submit" className="rounded-lg bg-slate-100 px-3 py-1.5 text-slate-700 hover:bg-slate-200">
            Apply
          </button>
        </form>
      </nav>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Median: invite → consent" value={d1(ins.timing.toConsent)} />
        <StatTile label="Median: invite → AI rounds done" value={d1(ins.timing.toAiDone)} />
        <StatTile label="Median: AI rounds → final decision" value={d1(ins.timing.aiDoneToDecision)} />
        <StatTile label="Median time to decision" value={d1(ins.timing.toDecision)} sub="invite → offer or rejection" />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card title="Funnel">
          <BarList
            caption="Candidates reaching each step"
            labelWidth="w-48"
            rows={ins.steps.map((s) => ({ label: s.label, value: s.value, display: s.fromPrevious == null ? String(s.value) : `${s.value} · ${pct(s.fromPrevious)} of previous`, hint: s.fromStart == null ? undefined : `${pct(s.fromStart)} of everyone invited` }))}
          />
        </Card>
        <Card title="Where candidates came from">
          {ins.sources.length === 0 ? (
            <p className="text-sm text-slate-500">No candidates in this period.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Source</th>
                  <th className="py-2 pr-3">Candidates</th>
                  <th className="py-2 pr-3">Finished AI rounds</th>
                  <th className="py-2">Offers</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ins.sources.map((s) => (
                  <tr key={s.source}>
                    <td className="py-2 pr-3">{s.label}</td>
                    <td className="py-2 pr-3 tabular-nums">{s.invited}</td>
                    <td className="py-2 pr-3 tabular-nums">{`${s.aiDone} (${pct(s.invited ? s.aiDone / s.invited : null)})`}</td>
                    <td className="py-2 tabular-nums">{s.offers}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card title="People's decisions vs the AI">
          {ins.ai.n === 0 ? (
            <p className="text-sm text-slate-500">No final decisions on candidates with an AI report yet.</p>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-3 gap-3">
                <StatTile label="Same call as the AI" value={pct(ins.ai.rate)} sub={`${ins.ai.agree} of ${ins.ai.n} decisions`} />
                <StatTile label="AI said hire, people rejected" value={String(ins.ai.aiHireRejected)} />
                <StatTile label="AI said no, people offered" value={String(ins.ai.aiNoOffered)} />
              </div>
              <p className="text-xs text-slate-600">An offer counts as agreeing with Strong Hire / Hire; a rejection with Lean No / No Hire. Holds are left out. Overruling the AI is expected sometimes; these are the cases worth a look.</p>
              {ins.overruled.length > 0 && (
                <ul className="divide-y divide-slate-100">
                  {ins.overruled.map((o) => (
                    <li key={o.candidacyId} className="py-1.5">
                      <Link href={`/app/candidates/${o.candidacyId}`} className="font-medium text-brand-700 hover:underline">
                        {o.drive}
                      </Link>
                      {` — AI ${RECOMMENDATION_LABEL[o.ai]}, decision: ${o.decision}. “${o.reason.slice(0, 140)}${o.reason.length > 140 ? "…" : ""}”`}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>
        <Card title="Agreement between panelists">
          {ins.panel.interviews === 0 ? (
            <p className="text-sm text-slate-500">No panel interviews with two or more scorecards yet.</p>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-3 gap-3">
                <StatTile label="Ratings within one point" value={pct(ins.panel.withinOne)} sub={`${ins.panel.ratingPairs} rating pairs`} />
                <StatTile label="Same side of the hire line" value={pct(ins.panel.sameSide)} sub={`${ins.panel.recommendationPairs} panelist pairs`} />
                <StatTile label="Average spread" value={ins.panel.meanSpread == null ? "—" : ins.panel.meanSpread.toFixed(1)} sub="points per competency" />
              </div>
              <p className="text-xs text-slate-600">{`Across ${ins.panel.interviews} panel interview${ins.panel.interviews === 1 ? "" : "s"}. Low agreement usually means competencies need clearer definitions or interviewers need calibrating.`}</p>
            </div>
          )}
        </Card>
      </div>

      <Card title="By hiring drive">
        {ins.drives.length === 0 ? (
          <p className="text-sm text-slate-500">No candidates in this period.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2 pr-3">Drive</th>
                <th className="py-2 pr-3">Candidates</th>
                <th className="py-2 pr-3">Finished AI rounds</th>
                <th className="py-2 pr-3">Offers</th>
                <th className="py-2">Median time to decision</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ins.drives.slice(0, 20).map((d) => (
                <tr key={d.id}>
                  <td className="py-2 pr-3">
                    <Link href={`/app/drives/${d.id}`} className="text-brand-700 hover:underline">
                      {d.drive}
                    </Link>
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{d.invited}</td>
                  <td className="py-2 pr-3 tabular-nums">{d.aiDone}</td>
                  <td className="py-2 pr-3 tabular-nums">{d.offers}</td>
                  <td className="py-2 tabular-nums">{d1(d.medianDaysToDecision)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {ins.drives.length > 20 && <p className="mt-2 text-xs text-slate-600">{`Showing the 20 busiest of ${ins.drives.length} drives — all of them are in the CSV export.`}</p>}
      </Card>
    </>
  );
}
