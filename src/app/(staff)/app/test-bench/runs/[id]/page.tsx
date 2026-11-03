import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/auth/staff";
import { HttpError } from "@/lib/auth/staff";
import { expectedRoundScore, runDetail } from "@/lib/services/benchmark";
import { BENCH, type Expected } from "@/lib/core/benchmark";
import { PARAMETERS } from "@/lib/core/rubrics";
import { RECOMMENDATION_LABEL, type Recommendation } from "@/lib/core/types";
import { Badge, Card, PageHeader, cx } from "@/components/ui";
import { RunActions } from "@/components/staff/test-bench";
import { VerdictBadge } from "@/components/staff/verdict-badge";

export const dynamic = "force-dynamic";

const pct = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const num = (x: number | null | undefined, d = 2) => (x == null ? "—" : x.toFixed(d));
const label = (id: string) => Object.values(PARAMETERS).flat().find((p) => p.id === id)?.label ?? id;
const rec = (r: string | null) => (r ? (RECOMMENDATION_LABEL[r as Recommendation] ?? r) : "—");

function Tile({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-600">{title}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-600">{hint}</p>
    </div>
  );
}

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaffPage("admin");
  const { id } = await params;
  const data = await runDetail(user, id).catch((e) => {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  });
  const { run, results, cases, summary, cost } = data;
  const weights = new Map(cases.map((c) => [c.id, c.weights]));
  const done = results.filter((r) => r.status !== "queued").length;
  const s = summary;
  const bias = s.overall.bias;

  return (
    <>
      <Link href="/app/test-bench" className="text-sm text-brand-600 hover:underline">
        ← Test bench
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {run.label}
            {run.isBaseline && <Badge tone="blue">baseline</Badge>}
            {run.status === "completed" ? <VerdictBadge verdict={s.verdict} /> : <Badge tone={run.status === "running" ? "blue" : "slate"}>{run.status}</Badge>}
          </span>
        }
        subtitle={`${run.model}${run.modelOverride ? " (tried — not the live model)" : ""} · ${run.caseCount} case${run.caseCount === 1 ? "" : "s"}${run.repeats > 1 ? `, each scored ${run.repeats} times` : ""} · ${run.createdAt.toLocaleString()}${cost ? ` · about $${cost.toFixed(2)}` : ""}`}
        actions={<RunActions runId={run.id} status={run.status} isBaseline={run.isBaseline} />}
      />

      {run.status === "running" && (
        <div role="status" className="mb-6 rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm">
          <p className="font-medium">{`Scoring… ${done} of ${results.length} done`}</p>
          <div className="mt-2 h-2 rounded-full bg-white">
            <div className="h-2 rounded-full bg-brand-600" style={{ width: `${results.length ? Math.round((done / results.length) * 100) : 0}%` }} />
          </div>
          <p className="mt-2 text-xs text-slate-600">This page updates by itself. The numbers below cover the cases scored so far.</p>
        </div>
      )}

      <Card title="What this run shows" className="mb-6">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {s.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        {s.lowSample && <p className="mt-2 text-sm text-amber-800">{`Only ${s.cases} case${s.cases === 1 ? "" : "s"} — add at least ${BENCH.minCases} (ideally 10+ per round type) before relying on this.`}</p>}
        {s.failed > 0 && <p className="mt-2 text-sm text-red-700">{`${s.failed} scoring${s.failed === 1 ? "" : "s"} failed (see the cases below) and are left out of the numbers.`}</p>}
      </Card>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile title="Average difference" value={s.overall.mae == null ? "—" : `${num(s.overall.mae)} pts`} hint={`Per parameter, on the 1–5 scale. Target ${BENCH.passMae} or less.`} />
        <Tile title="Within one point" value={pct(s.overall.withinOne)} hint={`Exactly the same: ${pct(s.overall.exact)}.`} />
        <Tile title="Same hire / no-hire call" value={pct(s.recommendation.sameSide)} hint={`Same recommendation exactly: ${pct(s.recommendation.exact)}. Target ${pct(BENCH.passSameSide)}.`} />
        <Tile title="Lean" value={bias == null ? "—" : Math.abs(bias) < 0.1 ? "none" : `${bias > 0 ? "+" : "−"}${num(Math.abs(bias))}`} hint={bias == null || Math.abs(bias) < 0.1 ? "Neither stricter nor more generous than your team." : bias > 0 ? "More generous than your team." : "Stricter than your team."} />
      </div>

      {s.comparison && s.comparedWith && (
        <Card title={`Compared with ${s.comparedWith.baseline ? "the baseline" : "the previous run"}: ${s.comparedWith.label}`} className="mb-6">
          <p className="text-sm">
            {`Across ${s.comparison.cases} shared case${s.comparison.cases === 1 ? "" : "s"}, round scores moved by ${s.comparison.meanShift == null ? "—" : `${s.comparison.meanShift > 0 ? "+" : ""}${s.comparison.meanShift}`} points on average (0–100 scale). `}
            {s.comparison.crossedHireLine.length ? `${s.comparison.crossedHireLine.length} case${s.comparison.crossedHireLine.length === 1 ? "" : "s"} crossed the hire line.` : "No case crossed the hire line."}
          </p>
          {(s.comparison.crossedHireLine.length > 0 || s.comparison.bigMoves.length > 0) && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {s.comparison.crossedHireLine.map((c) => (
                <li key={`x${c.caseId}`}>{`${c.caseTitle}: ${rec(c.from)} → ${rec(c.to)}`}</li>
              ))}
              {s.comparison.bigMoves.map((c) => (
                <li key={`m${c.caseId}`}>{`${c.caseTitle}: score ${c.from} → ${c.to}`}</li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-slate-600">
            <Link href={`/app/test-bench/runs/${s.comparedWith.runId}`} className="text-brand-600 hover:underline">
              Open that run
            </Link>
          </p>
        </Card>
      )}

      {Object.keys(s.byParameter).length > 0 && (
        <Card title="By parameter" className="mb-6">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Parameter</th>
                  <th className="py-2 pr-3">Scored</th>
                  <th className="py-2 pr-3">Avg difference</th>
                  <th className="py-2 pr-3">Within one point</th>
                  <th className="py-2">Lean</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {Object.entries(s.byParameter)
                  .sort((a, b) => (b[1].mae ?? 0) - (a[1].mae ?? 0))
                  .map(([pid, a]) => (
                    <tr key={pid}>
                      <td className="py-2 pr-3">{label(pid)}</td>
                      <td className="py-2 pr-3">{a.n}</td>
                      <td className={cx("py-2 pr-3", (a.mae ?? 0) > BENCH.failMae && "font-semibold text-red-700")}>{num(a.mae)}</td>
                      <td className="py-2 pr-3">{pct(a.withinOne)}</td>
                      <td className="py-2">{a.bias == null ? "—" : `${a.bias > 0 ? "+" : ""}${num(a.bias)}`}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card title="Cases">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 pr-3">Case</th>
                <th className="py-2 pr-3">Your team</th>
                <th className="py-2 pr-3">AI</th>
                <th className="py-2">Differences</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {results.map((r) => {
                const e = r.expected as Expected;
                const outcome = s.outcomes.find((o) => o.caseId === r.caseId);
                const w = r.caseId ? weights.get(r.caseId) : undefined;
                const expScore = w ? expectedRoundScore(e, w) : null;
                const gaps = Object.entries(e.params)
                  .filter(([k, v]) => typeof v === "number" && typeof r.params?.[k] === "number" && v !== r.params[k])
                  .map(([k, v]) => ({ k, from: v as number, to: r.params![k] as number }));
                return (
                  <tr key={r.id} className={cx(outcome?.bigMiss && r.status === "done" && "bg-red-50/60")}>
                    <td className="py-2 pr-3 align-top">
                      {r.caseId ? (
                        <Link href={`/app/test-bench/cases/${r.caseId}`} className="font-medium text-brand-600 hover:underline">
                          {r.caseTitle}
                        </Link>
                      ) : (
                        <span>{`${r.caseTitle} (deleted)`}</span>
                      )}
                      {run.repeats > 1 && <span className="ml-1 text-xs text-slate-500">{`#${r.repeat}`}</span>}
                      {r.repeat === 1 && outcome?.bigMiss && r.status === "done" && <Badge tone="red" className="ml-2">big miss</Badge>}
                      {r.repeat === 1 && outcome?.unstable && <Badge tone="amber" className="ml-2">inconsistent</Badge>}
                    </td>
                    <td className="py-2 pr-3 align-top">{`${rec(e.recommendation)}${expScore != null ? ` · ${expScore}` : ""}`}</td>
                    <td className="py-2 pr-3 align-top">
                      {r.status === "done" ? `${rec(r.recommendation)}${r.roundScore != null ? ` · ${r.roundScore}` : ""}` : r.status === "queued" ? <span className="text-slate-500">waiting…</span> : <span className="text-red-700">{`${r.status}${r.error ? `: ${r.error}` : ""}`}</span>}
                    </td>
                    <td className="py-2 align-top text-xs">
                      {r.status !== "done" ? "" : gaps.length === 0 ? <span className="text-emerald-700">all parameters match</span> : (
                        <ul className="space-y-0.5">
                          {gaps.map((g) => (
                            <li key={g.k} className={cx(Math.abs(g.to - g.from) >= 2 && "font-semibold text-red-700")}>{`${label(g.k)}: ${g.from} → ${g.to}`}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
