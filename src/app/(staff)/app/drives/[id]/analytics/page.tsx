import Link from "next/link";
import { notFound } from "next/navigation";
import { canSeeDrive, requireStaffPage } from "@/lib/auth/staff";
import { driveAnalytics } from "@/lib/services/analytics";
import { Card, PageHeader } from "@/components/ui";
import { BarList, Histogram, StatTile } from "@/components/charts";

export const dynamic = "force-dynamic";

const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const mins = (x: number | null) => (x == null ? "—" : x < 1 ? "<1" : String(Math.round(x)));

export default async function AnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaffPage();
  const { id } = await params;
  if (!canSeeDrive(user, id)) notFound();
  const a = await driveAnalytics(id);
  if (!a) notFound();
  const k = a.kpis;
  const hireBin = Math.floor(a.config.bands.hire / 10);
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Analytics: ${a.drive.title}`}
        subtitle={
          <Link href={`/app/drives/${id}`} className="text-brand-600 hover:underline">
            ← Back to drive
          </Link>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Candidates" value={String(k.candidates)} sub={`${k.consented} consented`} />
        <StatTile label="Completed all rounds" value={String(k.completedAll)} sub={`${pct(k.completionRate)} of consented`} />
        <StatTile label="Average final score" value={k.avgFinal == null ? "—" : k.avgFinal.toFixed(0)} sub="out of 100" />
        <StatTile label="AI scores kept" value={pct(k.scoreAgreement)} sub={`${k.overriddenParams} of ${k.scoredParams} parameters overridden`} />
        <StatTile label="Gate agreement" value={pct(k.gateAgreement)} sub={`${k.manualGates} manual decision(s) vs AI`} />
        <StatTile
          label="Median round length"
          value={a.durations[0]?.median != null ? `${mins(a.durations[0].median)} min` : "—"}
          sub={a.durations.map((d) => `${d.type === "technical" ? "Tech" : d.type === "managerial" ? "Mgr" : "HR"} ${mins(d.median)}/${d.configured} min`).join(" · ")}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Funnel — candidates reaching each step">
          <BarList rows={a.funnel} caption="Candidates reaching each step" labelWidth="w-52" />
        </Card>
        <Card title="Where candidates dropped out">
          {a.dropOff.length ? <BarList rows={a.dropOff} caption="Drop-off by section" labelWidth="w-64" /> : <p className="text-sm text-slate-500">No drop-offs recorded.</p>}
        </Card>
      </div>

      <Card title="Score distributions">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="mb-3 text-sm font-medium">Final score · {a.finalBins.reduce((x, b) => x + b.count, 0)} candidates</p>
            <Histogram bins={a.finalBins} caption="Final score distribution" reference={{ atIndex: hireBin, label: `Hire ≥ ${a.config.bands.hire}` }} />
          </div>
          {a.roundScores.map((r) => (
            <div key={r.type}>
              <p className="mb-3 text-sm font-medium">
                {r.label} · {r.n}
              </p>
              <Histogram bins={r.bins} caption={`${r.label} score distribution`} reference={{ atIndex: hireBin, label: `Hire ≥ ${a.config.bands.hire}` }} />
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        {a.paramAverages.map((r) => (
          <Card key={r.type} title={`Average parameter scores — ${r.label}`}>
            <BarList rows={r.rows} max={5} caption={`Average parameter scores for ${r.label}`} labelWidth="w-40" />
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Practical-fit mismatches (HR round)">
          {a.fitMismatch.length ? <BarList rows={a.fitMismatch} caption="Practical fit mismatches by field" /> : <p className="text-sm text-slate-500">No mismatches.</p>}
        </Card>
        <Card title="Integrity concern level (worst per candidate)">
          <BarList rows={a.integrity} caption="Integrity concern levels" />
          <p className="mt-2 text-xs text-slate-500">Context only — never part of the score.</p>
        </Card>
      </div>
    </div>
  );
}
