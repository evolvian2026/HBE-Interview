import Link from "next/link";

import { requireDrivePage, requireStaffPage } from "@/lib/auth/staff";
import { driveFairness } from "@/lib/services/feedback";
import { FOUR_FIFTHS, MIN_COHORT } from "@/lib/core/fairness";
import { Badge, Card, PageHeader } from "@/components/ui";
import { StatTile } from "@/components/charts";

export const dynamic = "force-dynamic";

const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const one = (x: number | null) => (x == null ? "—" : x.toFixed(1));

export default async function FairnessPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaffPage("recruiter");
  const { id } = await params;
  const drive = await requireDrivePage(user, id);
  const f = await driveFairness(id);
  const flagged = f.dimensions.filter((d) => d.key !== "round").flatMap((d) => d.stats.filter((s) => s.flagged).map((s) => `${d.label}: ${s.cohort}`));
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Fairness monitor: ${drive.title}`}
        subtitle={
          <span className="flex gap-3">
            <Link href={`/app/drives/${id}`} className="text-brand-600 hover:underline">
              ← Back to drive
            </Link>
            <Link href={`/app/drives/${id}/analytics`} className="text-brand-600 hover:underline">
              Analytics
            </Link>
          </span>
        }
      />
      <Card>
        <p className="text-sm text-slate-700">
          Compares round outcomes across <strong>process cohorts</strong> — how candidates took the interview, not who they are. HBE Interview collects no demographic data, so this cannot detect bias by gender,
          caste, age or other protected characteristics; use an independent, consented audit for that. A cohort is flagged when its pass rate (AI recommendation Hire or Strong Hire) is below{" "}
          {Math.round(FOUR_FIFTHS * 100)}% of the best-performing cohort&apos;s (the four-fifths rule). Cohorts with fewer than {MIN_COHORT} rounds are not compared.
        </p>
      </Card>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Evaluated rounds" value={String(f.rounds)} sub={`${f.candidates} candidate${f.candidates === 1 ? "" : "s"}`} />
        <StatTile label="Cohorts flagged" value={String(flagged.length)} sub={flagged.length ? flagged.join(" · ") : "None below the four-fifths ratio"} />
        <StatTile label="Evaluator runs disagreed" value={pct(f.disagreementRate)} sub="rounds needing a third evaluator run" />
        <StatTile label="Candidate rating" value={f.survey.overall == null ? "—" : `${one(f.survey.overall)}/5`} sub={`${f.survey.responses} survey response${f.survey.responses === 1 ? "" : "s"} · fairness ${one(f.survey.fairness)}/5`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {f.dimensions.map((d) => (
          <Card key={d.key} title={d.label}>
            <p className="mb-2 text-xs text-slate-500">{d.help}</p>
            {d.stats.length === 0 ? (
              <p className="text-sm text-slate-500">No evaluated rounds yet.</p>
            ) : (
              <table className="w-full text-sm">
                <caption className="sr-only">Pass rate by {d.label.toLowerCase()}</caption>
                <thead className="text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-1">Cohort</th>
                    <th className="text-right">Rounds</th>
                    <th className="w-1/3 pl-3">Pass rate</th>
                    <th className="text-right">Ratio</th>
                    <th className="text-right">Mean score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {d.stats.map((s) => (
                    <tr key={s.cohort}>
                      <td className="py-1.5">
                        {s.cohort} {s.flagged && d.key !== "round" && <Badge tone="red">below 4/5</Badge>}
                      </td>
                      <td className="text-right">{s.n}</td>
                      <td className="pl-3">
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 rounded bg-slate-100">
                            <div className="h-2 rounded" style={{ width: `${Math.round(s.passRate * 100)}%`, background: "#2a78d6" }} />
                          </div>
                          <span className="w-10 text-right">{pct(s.passRate)}</span>
                        </div>
                      </td>
                      <td className="text-right">{s.small ? <span className="text-xs text-slate-500">n&lt;{MIN_COHORT}</span> : s.impactRatio == null ? "—" : s.impactRatio.toFixed(2)}</td>
                      <td className="text-right">{s.meanScore == null ? "—" : s.meanScore.toFixed(0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {f.experience.map((e) => (
          <Card key={e.key} title={`Candidate experience & evaluator consistency — ${e.label}`}>
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-1">Cohort</th>
                  <th className="text-right">Rounds</th>
                  <th className="text-right">Runs disagreed</th>
                  <th className="text-right">Responses</th>
                  <th className="text-right">Overall</th>
                  <th className="text-right">Fairness</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {e.rows.map((r) => (
                  <tr key={r.cohort}>
                    <td className="py-1.5">{r.cohort}</td>
                    <td className="text-right">{r.rounds}</td>
                    <td className="text-right">{pct(r.disagreementRate)}</td>
                    <td className="text-right">{r.responses}</td>
                    <td className="text-right">{one(r.overall)}</td>
                    <td className="text-right">{one(r.fairness)}</td>
                  </tr>
                ))}
                {e.rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-2 text-slate-500">
                      No data yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        ))}
      </div>

      <Card title="Recent candidate comments">
        {f.survey.comments.length === 0 ? (
          <p className="text-sm text-slate-500">No comments yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {f.survey.comments.map((c, i) => (
              <li key={i} className="rounded-lg bg-slate-50 p-2">
                <p className="whitespace-pre-wrap">“{c.comment}”</p>
                <p className="mt-1 text-xs text-slate-500">
                  rated {c.overall}/5 · {c.at.toLocaleDateString()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
