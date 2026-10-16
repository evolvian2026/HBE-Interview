import Link from "next/link";
import { requireStaffPage } from "@/lib/auth/staff";
import { aiUsage, PRICES } from "@/lib/services/analytics";
import { orgBudget } from "@/lib/services/platform";
import { Card, PageHeader, cx } from "@/components/ui";
import { BarList, StatTile } from "@/components/charts";

export const dynamic = "force-dynamic";

const RANGES = [
  { key: "7", label: "Last 7 days" },
  { key: "30", label: "Last 30 days" },
  { key: "90", label: "Last 90 days" },
  { key: "all", label: "All time" },
];
const usd = (x: number) => (x < 1 ? `$${x.toFixed(3)}` : `$${x.toFixed(2)}`);
const tok = (x: number) => (x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1e3 ? `${(x / 1e3).toFixed(1)}k` : String(x));

export default async function UsagePage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const user = await requireStaffPage("admin");
  const { range = "30" } = await searchParams;
  const u = await aiUsage(range === "all" ? null : Number(range), user.orgId);
  const budget = await orgBudget(user.orgId);
  return (
    <div className="space-y-6">
      <PageHeader title="AI usage & cost" subtitle="Estimated from recorded token usage at list prices. Mock-mode calls are not recorded." />
      <div className="flex flex-wrap gap-2 text-sm">
        {RANGES.map((r) => (
          <Link key={r.key} href={`/app/usage?range=${r.key}`} className={cx("rounded-full px-3 py-1", range === r.key ? "bg-brand-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50")}>
            {r.label}
          </Link>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Estimated cost" value={usd(u.total)} />
        <StatTile label="Cost per completed round" value={u.perRound == null ? "—" : usd(u.perRound)} sub={`${u.roundsEnded} round(s) ended`} />
        <StatTile label="Model calls" value={String(u.calls)} sub={`${u.errors} error(s)`} />
        <StatTile label="Input served from cache" value={u.cacheShare == null ? "—" : `${Math.round(u.cacheShare * 100)}%`} />
        <StatTile
          label="This month vs budget"
          value={budget.budget == null ? usd(budget.spent) : `${Math.round((budget.ratio ?? 0) * 100)}%`}
          sub={budget.budget == null ? "No monthly budget set (platform admins set it)" : `${usd(budget.spent)} of ${usd(budget.budget)} · target ≤ $1.50 per technical round`}
        />
      </div>
      <Card title="Cost by pipeline stage">
        {u.byStage.length ? (
          <BarList rows={u.byStage.map((r) => ({ label: `${r.stage} (${r.model.replace("claude-", "")})`, value: r.cost, display: usd(r.cost), hint: `${r.calls} calls` }))} caption="Estimated cost by stage" labelWidth="w-72" />
        ) : (
          <p className="text-sm text-slate-500">No AI calls recorded in this period.</p>
        )}
      </Card>
      <Card title="Detail">
        <div className="-m-5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {["Stage", "Model", "Calls", "Errors", "Input", "Cache read", "Cache write", "Output", "p50 latency", "Est. cost"].map((h) => (
                  <th key={h} className="px-3 py-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {u.byStage.map((r) => (
                <tr key={`${r.stage}-${r.model}`}>
                  <td className="px-3 py-2">{r.stage}</td>
                  <td className="px-3 py-2">{r.model}</td>
                  <td className="px-3 py-2">{r.calls}</td>
                  <td className="px-3 py-2">{r.errors}</td>
                  <td className="px-3 py-2">{tok(r.input)}</td>
                  <td className="px-3 py-2">{tok(r.cacheRead)}</td>
                  <td className="px-3 py-2">{tok(r.cacheWrite)}</td>
                  <td className="px-3 py-2">{tok(r.output)}</td>
                  <td className="px-3 py-2">{(r.p50 / 1000).toFixed(1)}s</td>
                  <td className="px-3 py-2 font-medium">{usd(r.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-6 text-xs text-slate-500">
          Prices used ($/M tokens in · out · cache read): {Object.entries(PRICES).map(([m, p]) => `${m} ${p.input} · ${p.output} · ${p.cacheRead}`).join("; ")}. Cache writes at 1.25× input.
        </p>
      </Card>
    </div>
  );
}
