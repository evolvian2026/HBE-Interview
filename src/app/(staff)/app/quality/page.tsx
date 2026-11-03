import Link from "next/link";
import { requireStaffPage } from "@/lib/auth/staff";
import { qualityData } from "@/lib/services/hires";
import { MIN_HIRES, strengthText } from "@/lib/core/quality";
import { RECOMMENDATION_LABEL } from "@/lib/core/types";
import { Badge, Card, PageHeader, cx } from "@/components/ui";

export const dynamic = "force-dynamic";

const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const num = (x: number | null) => (x == null ? "—" : x.toFixed(2));
const TONE = { too_few: "slate", none: "slate", weak: "amber", moderate: "blue", strong: "green" } as const;

function Tile({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-600">{title}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-600">{hint}</p>
    </div>
  );
}

export default async function QualityPage({ searchParams }: { searchParams: Promise<{ drive?: string }> }) {
  const user = await requireStaffPage("recruiter");
  const sp = await searchParams;
  const { stats: s, drives, declined } = await qualityData(user, { driveId: sp.drive || undefined });
  return (
    <>
      <PageHeader
        title="Quality of hire"
        subtitle="Do the people the interviews favoured turn out to do well? Managers rate each hire at 90 and 180 days (without seeing the interview results); this page relates those ratings to what the interviews said at the time of the offer."
        actions={
          <Link href="/app/hires" className="rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
            Hires →
          </Link>
        }
      />
      {drives.length > 1 && (
        <nav aria-label="Drive" className="mb-4 flex flex-wrap gap-2 text-sm">
          <Link href="/app/quality" aria-current={!sp.drive ? "page" : undefined} className={cx("rounded-full px-3 py-1", !sp.drive ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700")}>
            All drives
          </Link>
          {drives.map((d) => (
            <Link key={d.id} href={`/app/quality?drive=${d.id}`} aria-current={sp.drive === d.id ? "page" : undefined} className={cx("rounded-full px-3 py-1", sp.drive === d.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700")}>
              {d.title}
            </Link>
          ))}
        </nav>
      )}
      {s.tooEarly && (
        <p role="status" className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {`${s.rated} hire${s.rated === 1 ? " has" : "s have"} been rated so far. Relationships are shown from ${MIN_HIRES} rated hires — until then, treat the numbers as anecdotes.`}
        </p>
      )}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile title="Offers" value={String(s.hires + declined)} hint={`${s.joined} joined · ${declined} declined`} />
        <Tile title="Average manager rating" value={s.avgRating == null ? "—" : `${num(s.avgRating)} / 5`} hint={`${s.rated} rated hire${s.rated === 1 ? "" : "s"} (latest check-in)`} />
        <Tile title="Would hire again" value={pct(s.rehireShare)} hint="Managers answering yes" />
        <Tile title="Left within 90 days" value={pct(s.earlyAttrition)} hint="Of those who joined" />
      </div>
      <Card title="Which interview signals predict later ratings?" className="mb-6">
        {s.predictors.length === 0 ? (
          <p className="text-sm text-slate-600">No rated hires yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Signal at offer</th>
                  <th className="py-2 pr-3">Rated hires</th>
                  <th className="py-2 pr-3">Rank correlation</th>
                  <th className="py-2 pr-3">Rating: top half / bottom half</th>
                  <th className="py-2">What it means</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {s.predictors.map((p) => (
                  <tr key={p.key}>
                    <td className="py-2 pr-3">{p.label}</td>
                    <td className="py-2 pr-3">{p.n}</td>
                    <td className="py-2 pr-3">
                      {p.rho == null ? "—" : p.rho.toFixed(2)} <Badge tone={TONE[p.strength]}>{p.strength === "too_few" ? "too early" : p.strength}</Badge>
                    </td>
                    <td className="py-2 pr-3">{`${num(p.topHalf)} / ${num(p.bottomHalf)}`}</td>
                    <td className="py-2 text-slate-700">{strengthText(p)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-600">Rank correlation runs from −1 to 1: positive means hires with higher scores were later rated higher. Only people who were hired are rated, so this can't show how rejected candidates would have done.</p>
      </Card>
      <Card title="AI recommendation at offer vs. how hires did">
        {s.byRecommendation.length === 0 ? (
          <p className="text-sm text-slate-600">No rated hires yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 pr-3">AI recommendation</th>
                <th className="py-2 pr-3">Rated hires</th>
                <th className="py-2 pr-3">Average rating</th>
                <th className="py-2">Would hire again</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {s.byRecommendation.map((r) => (
                <tr key={r.recommendation}>
                  <td className="py-2 pr-3">{RECOMMENDATION_LABEL[r.recommendation]}</td>
                  <td className="py-2 pr-3">{r.n}</td>
                  <td className="py-2 pr-3">{num(r.avgRating)}</td>
                  <td className="py-2">{pct(r.rehire)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
