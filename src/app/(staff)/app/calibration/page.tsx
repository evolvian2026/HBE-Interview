import Link from "next/link";
import { hasRole, requireStaffPage } from "@/lib/auth/staff";
import { calibrationQueue, calibrationStats } from "@/lib/services/calibration";
import { getSettings } from "@/lib/settings";
import { RECS, ALERT_WITHIN_ONE, MIN_REVIEWS_FOR_ALERT, type AgreementStat } from "@/lib/core/calibration";
import { RECOMMENDATION_LABEL, ROUND_LABEL, type RoundType } from "@/lib/core/types";
import { Badge, Card, Empty, PageHeader, cx } from "@/components/ui";

export const dynamic = "force-dynamic";

const REASON: Record<string, string> = { sample: "random sample", low_confidence: "low AI confidence", requested: "requested" };
const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const num = (x: number | null, d = 2) => (x == null ? "—" : x.toFixed(d));
const signed = (x: number | null) => (x == null ? "—" : `${x > 0 ? "+" : ""}${x.toFixed(2)}`);

export default async function CalibrationPage({ searchParams }: { searchParams: Promise<{ days?: string; round?: string; all?: string }> }) {
  const user = await requireStaffPage("hiring_manager");
  const sp = await searchParams;
  const days = [30, 90, 365].includes(Number(sp.days)) ? Number(sp.days) : 90;
  const roundType = (["technical", "managerial", "hr"] as const).find((t) => t === sp.round) as RoundType | undefined;
  const includeNonBlind = sp.all === "1";
  const queue = await calibrationQueue(user);
  const canSeeStats = hasRole(user, "recruiter");
  const stats = canSeeStats ? await calibrationStats(user, { days, roundType, includeNonBlind }) : null;
  const settings = await getSettings(user.orgId);
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams({ days: String(days), ...(roundType ? { round: roundType } : {}), ...(includeNonBlind ? { all: "1" } : {}), ...patch } as Record<string, string>);
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return `/app/calibration?${p}`;
  };

  return (
    <>
      <PageHeader
        title="Calibration"
        subtitle={`People score a sample of AI-evaluated rounds without seeing the AI's scores, so you can see how far to trust the AI. Sampling: ${settings.calibration.sampleRate}% of rounds${settings.calibration.includeLowConfidence ? ", plus every low-confidence evaluation" : ""}${user.role === "admin" ? " (change in Settings)" : ""}.`}
        actions={
          canSeeStats ? (
            <a href={`/api/calibration/export?days=${days}${roundType ? `&round=${roundType}` : ""}${includeNonBlind ? "&all=1" : ""}`} className="rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
              Export CSV
            </a>
          ) : undefined
        }
      />

      <Card title={`Waiting for a blind review (${queue.length})`} className="mb-6">
        {queue.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing waiting. New rounds are added as they're evaluated.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {queue.slice(0, 50).map((q) => (
              <li key={q.reportId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <b>{q.driveTitle}</b> · {ROUND_LABEL[q.roundType as RoundType]} · <span className="text-slate-500">{REASON[q.reason ?? "sample"]}, {q.requestedAt?.toLocaleDateString()}</span>
                </span>
                <Link href={`/app/calibration/${q.reportId}`} className="font-medium text-brand-600 hover:underline">
                  Review blind →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {stats && (
        <>
          <nav aria-label="Filters" className="mb-4 flex flex-wrap items-center gap-2 text-sm">
            {[30, 90, 365].map((d) => (
              <Link key={d} href={qs({ days: String(d) })} aria-current={d === days ? "page" : undefined} className={cx("rounded-full px-3 py-1", d === days ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700")}>
                {d} days
              </Link>
            ))}
            <span className="mx-2 text-slate-300">|</span>
            {[undefined, "technical", "managerial", "hr"].map((t) => (
              <Link key={t ?? "all"} href={qs({ round: t })} aria-current={t === roundType ? "page" : undefined} className={cx("rounded-full px-3 py-1", t === roundType ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700")}>
                {t ? ROUND_LABEL[t as RoundType].replace(" Round", "").replace(" / Functional", "") : "All rounds"}
              </Link>
            ))}
            <span className="mx-2 text-slate-300">|</span>
            <Link href={qs({ all: includeNonBlind ? undefined : "1" })} className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
              {includeNonBlind ? "Including non-blind reviews" : "Blind reviews only"} (switch)
            </Link>
          </nav>

          {stats.alerts.length > 0 && (
            <div role="alert" className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-semibold">The AI is drifting from your reviewers</p>
              <ul className="mt-1 list-disc pl-5">
                {stats.alerts.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
              <p className="mt-1">Consider adjusting rubric weights, raising gates to manual for this round, or asking the platform team to review the evaluator.</p>
            </div>
          )}

          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <Tile label="Reviews" value={String(stats.reviews)} />
            <Tile label="Disagreed with the AI" value={stats.reviews ? `${stats.disagreements} (${pct(stats.disagreements / stats.reviews)})` : "—"} />
            <Tile label="Alert threshold" value={`${MIN_REVIEWS_FOR_ALERT}+ reviews`} hint={`within one point < ${ALERT_WITHIN_ONE * 100}%, or average gap ≥ 0.5`} />
          </div>

          {stats.rounds.length === 0 ? (
            <Empty>No reviews in this period yet.</Empty>
          ) : (
            stats.rounds.map((r) => (
              <Card key={r.type} title={`${ROUND_LABEL[r.type]} — ${r.reviews} review${r.reviews === 1 ? "" : "s"}`} className="mb-6">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Agreement between the AI and reviewers per parameter</caption>
                    <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="py-2 pr-3">Parameter</th>
                        <th className="py-2 pr-3">Pairs</th>
                        <th className="py-2 pr-3">AI avg</th>
                        <th className="py-2 pr-3">People avg</th>
                        <th className="py-2 pr-3" title="AI minus people: positive means the AI is more generous">AI − people</th>
                        <th className="py-2 pr-3">Exact</th>
                        <th className="py-2 pr-3">Within 1</th>
                        <th className="py-2" title="Quadratic weighted kappa: 1 = perfect agreement, 0 = chance">Kappa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {[...r.params, { id: "__all", label: "All parameters", ...r.overall }].map((p) => (
                        <StatRow key={p.id} label={p.label} s={p} bold={p.id === "__all"} />
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-5 grid gap-6 md:grid-cols-2">
                  <div>
                    <h3 className="mb-2 text-sm font-semibold">Recommendations (rows: AI, columns: people)</h3>
                    <table className="text-xs">
                      <thead>
                        <tr>
                          <th className="p-1" />
                          {RECS.map((h) => (
                            <th key={h} scope="col" className="p-1 font-medium text-slate-600">
                              {RECOMMENDATION_LABEL[h]}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {RECS.map((a, i) => (
                          <tr key={a}>
                            <th scope="row" className="p-1 text-left font-medium text-slate-600">
                              {RECOMMENDATION_LABEL[a]}
                            </th>
                            {r.rec.matrix[i].map((n, j) => (
                              <td key={j} className={cx("w-16 p-1 text-center tabular-nums", i === j ? "bg-emerald-50 font-semibold" : n ? "bg-amber-50" : "text-slate-400")}>
                                {n}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="text-sm">
                    <p>
                      Same recommendation: <b>{pct(r.rec.exact)}</b>
                    </p>
                    <p>
                      Same side of the hire line: <b>{pct(r.rec.sameSide)}</b>
                    </p>
                    <p className="mt-2 text-xs text-slate-600">A disagreement is a gap of 2+ points on any parameter, or the AI and the reviewer landing on different sides of the hire line.</p>
                  </div>
                </div>
              </Card>
            ))
          )}

          {stats.versions.length > 0 && (
            <Card title="By evaluator version" className="mb-6">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="py-2 pr-3">Model · prompt</th>
                    <th className="py-2 pr-3">Pairs</th>
                    <th className="py-2 pr-3">AI avg</th>
                    <th className="py-2 pr-3">People avg</th>
                    <th className="py-2 pr-3">AI − people</th>
                    <th className="py-2 pr-3">Exact</th>
                    <th className="py-2 pr-3">Within 1</th>
                    <th className="py-2">Kappa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stats.versions.map((v) => (
                    <StatRow key={v.version} label={v.version} s={v} mono />
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {stats.recent.length > 0 && (
            <Card title="Recent disagreements">
              <ul className="divide-y divide-slate-100 text-sm">
                {stats.recent.map(({ r, reviewer, driveTitle }) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      {driveTitle} · {ROUND_LABEL[r.roundType as RoundType]} · {reviewer ?? "former user"}: <b>{RECOMMENDATION_LABEL[r.recommendation as keyof typeof RECOMMENDATION_LABEL]}</b> vs AI <b>{RECOMMENDATION_LABEL[r.ai.recommendation as keyof typeof RECOMMENDATION_LABEL]}</b>
                      {!r.blind && <Badge className="ml-2">not blind</Badge>}
                    </span>
                    <Link href={`/app/candidates/${r.candidacyId}`} className="text-brand-600 hover:underline">
                      Open report
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function StatRow({ label, s, bold, mono }: { label: string; s: AgreementStat; bold?: boolean; mono?: boolean }) {
  const warn = s.n >= MIN_REVIEWS_FOR_ALERT && ((s.withinOne ?? 1) < ALERT_WITHIN_ONE || Math.abs(s.bias ?? 0) >= 0.5);
  return (
    <tr className={cx(bold && "font-semibold", warn && "bg-amber-50")}>
      <td className={cx("py-2 pr-3", mono && "font-mono text-xs")}>{label}</td>
      <td className="py-2 pr-3 tabular-nums">{s.n}</td>
      <td className="py-2 pr-3 tabular-nums">{num(s.meanAi)}</td>
      <td className="py-2 pr-3 tabular-nums">{num(s.meanHuman)}</td>
      <td className="py-2 pr-3 tabular-nums">{signed(s.bias)}</td>
      <td className="py-2 pr-3 tabular-nums">{pct(s.exact)}</td>
      <td className="py-2 pr-3 tabular-nums">{pct(s.withinOne)}</td>
      <td className="py-2 tabular-nums">{num(s.kappa)}</td>
    </tr>
  );
}
