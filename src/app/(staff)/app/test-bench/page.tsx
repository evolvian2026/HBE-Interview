import Link from "next/link";
import { requireStaffPage } from "@/lib/auth/staff";
import { currentEvaluatorModel, listCases, listRuns } from "@/lib/services/benchmark";
import { getSettings } from "@/lib/settings";
import { MODEL_CHOICES } from "@/lib/settings-shared";
import { BENCH } from "@/lib/core/benchmark";
import { RECOMMENDATION_LABEL, ROUND_LABEL, type Recommendation, type RoundType } from "@/lib/core/types";
import { Badge, Card, LinkButton, PageHeader } from "@/components/ui";
import { AddReviewedRounds, BenchRunForm } from "@/components/staff/test-bench";
import { VerdictBadge } from "@/components/staff/verdict-badge";

export const dynamic = "force-dynamic";

const SOURCE: Record<string, string> = { calibration: "blind review", override: "AI + your overrides", ai: "AI result — please confirm", manual: "set by your team" };
const pct = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)}%`);

export default async function TestBenchPage() {
  const user = await requireStaffPage("admin");
  const [cases, runs, settings, currentModel] = await Promise.all([listCases(user.orgId), listRuns(user.orgId), getSettings(user.orgId), currentEvaluatorModel()]);
  const active = cases.filter((c) => c.active);
  const latest = runs.find((r) => r.status === "completed");
  const running = runs.find((r) => r.status === "running");
  const toConfirm = cases.filter((c) => c.expectedSource === "ai").length;

  return (
    <>
      <PageHeader
        title="Scoring test bench"
        subtitle="A fixed set of interview rounds with the scores your team agreed on. Re-score them before changing the AI model or prompts — or every month — to see whether the AI has become stricter, more generous or less consistent."
      />

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card title="Latest result" className="lg:col-span-1">
          {latest?.summary ? (
            <div className="space-y-2 text-sm">
              <p className="flex flex-wrap items-center gap-2">
                <VerdictBadge verdict={latest.summary.verdict} />
                <span className="text-slate-600">{`${latest.label} · ${latest.model}`}</span>
              </p>
              <p>{latest.summary.reasons[0]}</p>
              <dl className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                <div>
                  <dt>Average difference</dt>
                  <dd className="text-base font-semibold text-slate-900">{latest.summary.overall.mae == null ? "—" : `${latest.summary.overall.mae.toFixed(2)} pts`}</dd>
                </div>
                <div>
                  <dt>Same hire call</dt>
                  <dd className="text-base font-semibold text-slate-900">{pct(latest.summary.recommendation.sameSide)}</dd>
                </div>
              </dl>
              <Link href={`/app/test-bench/runs/${latest.id}`} className="font-medium text-brand-600 hover:underline">
                Open the result →
              </Link>
            </div>
          ) : (
            <p className="text-sm text-slate-600">No completed runs yet.</p>
          )}
        </Card>
        <Card title="Run the test bench" className="lg:col-span-2">
          {running ? (
            <p className="mb-3 rounded-lg bg-brand-50 px-3 py-2 text-sm">
              {`A run is in progress (${running.progress?.done ?? 0} of ${running.progress?.total ?? "…"} scored). `}
              <Link href={`/app/test-bench/runs/${running.id}`} className="font-medium text-brand-600 hover:underline">
                Watch it →
              </Link>
            </p>
          ) : null}
          <BenchRunForm currentModel={currentModel} models={MODEL_CHOICES} caseCount={active.length} running={!!running} monthly={settings.testBenchMonthly} />
        </Card>
      </div>

      <Card
        title={`Test cases (${active.length} active of ${cases.length})`}
        className="mb-6"
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <AddReviewedRounds />
            <LinkButton href="/app/test-bench/cases/new" variant="secondary">
              Write a case
            </LinkButton>
          </span>
        }
      >
        <p className="mb-3 text-sm text-slate-600">
          {`Add rounds from a candidate's report ("Add to test bench"), add every round with a blind review in one go, or write a case from scratch. Aim for at least ${BENCH.minCases}–10 cases per round type, mixing strong, borderline and weak answers. Cases from real rounds are anonymised and deleted with the candidate's data; written cases are kept.`}
          {toConfirm > 0 && <b className="text-amber-800">{` ${toConfirm} case${toConfirm === 1 ? " still uses" : "s still use"} the AI's own scores as expected — open and confirm them, or the bench only checks the AI against itself.`}</b>}
        </p>
        {cases.length === 0 ? (
          <p className="text-sm text-slate-500">No test cases yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Case</th>
                  <th className="py-2 pr-3">Round</th>
                  <th className="py-2 pr-3">Expected</th>
                  <th className="py-2 pr-3">Scores from</th>
                  <th className="py-2">In runs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cases.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2 pr-3">
                      <Link href={`/app/test-bench/cases/${c.id}`} className="font-medium text-brand-600 hover:underline">
                        {c.title}
                      </Link>
                      {c.written && <Badge className="ml-2">written</Badge>}
                    </td>
                    <td className="py-2 pr-3">{ROUND_LABEL[c.roundType as RoundType]}</td>
                    <td className="py-2 pr-3">{`${RECOMMENDATION_LABEL[c.expected.recommendation as Recommendation] ?? "—"}${c.expectedScore != null ? ` · ${c.expectedScore}` : ""}`}</td>
                    <td className="py-2 pr-3">{c.expectedSource === "ai" ? <Badge tone="amber">{SOURCE.ai}</Badge> : SOURCE[c.expectedSource]}</td>
                    <td className="py-2">{c.active ? "yes" : <Badge>left out</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Runs">
        {runs.length === 0 ? (
          <p className="text-sm text-slate-500">No runs yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Run</th>
                  <th className="py-2 pr-3">Model</th>
                  <th className="py-2 pr-3">Cases</th>
                  <th className="py-2 pr-3">Avg difference</th>
                  <th className="py-2 pr-3">Same hire call</th>
                  <th className="py-2 pr-3">Result</th>
                  <th className="py-2">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2 pr-3">
                      <Link href={`/app/test-bench/runs/${r.id}`} className="font-medium text-brand-600 hover:underline">
                        {r.label}
                      </Link>
                      {r.isBaseline && <Badge tone="blue" className="ml-2">baseline</Badge>}
                      {r.trigger === "scheduled" && <Badge className="ml-2">monthly</Badge>}
                      <span className="block text-xs text-slate-500">{r.createdAt.toLocaleString()}</span>
                    </td>
                    <td className="py-2 pr-3">{`${r.model}${r.modelOverride ? " (tried)" : ""}`}</td>
                    <td className="py-2 pr-3">{`${r.caseCount}${r.repeats > 1 ? ` × ${r.repeats}` : ""}`}</td>
                    <td className="py-2 pr-3">{r.summary?.overall.mae == null ? "—" : `${r.summary.overall.mae.toFixed(2)} pts`}</td>
                    <td className="py-2 pr-3">{pct(r.summary?.recommendation.sameSide)}</td>
                    <td className="py-2 pr-3">
                      {r.status === "running" ? <Badge tone="blue">{`running ${r.progress?.done ?? 0}/${r.progress?.total ?? "…"}`}</Badge> : r.status === "completed" && r.summary ? <VerdictBadge verdict={r.summary.verdict} /> : <Badge>{r.status}</Badge>}
                    </td>
                    <td className="py-2">{r.cost ? `$${r.cost.toFixed(2)}` : "—"}</td>
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
