import Link from "next/link";
import { eq, inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { requireDrivePage, requireStaffPage } from "@/lib/auth/staff";
import { enabledRounds } from "@/lib/core/rounds";
import { PARAMETERS } from "@/lib/core/rubrics";
import { effectiveScore } from "@/lib/core/scoring";
import { RECOMMENDATION_LABEL, ROUND_LABEL, type DriveConfig, type ParamScore, type Recommendation } from "@/lib/core/types";
import type { Compatibility } from "@/lib/core/practical-fit";
import { Badge, Card, Empty, PageHeader, cx } from "@/components/ui";
import { FIT_TONE, REC_TONE, STAGE_LABEL } from "@/components/labels";

export const dynamic = "force-dynamic";

export default async function ComparePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ids?: string | string[] }> }) {
  const user = await requireStaffPage();
  const { id } = await params;
  const drive = await requireDrivePage(user, id);
  const raw = (await searchParams).ids;
  const all = (Array.isArray(raw) ? raw : raw ? raw.split(",") : []).filter(Boolean);
  const ids = all.slice(0, 4);
  if (ids.length < 2)
    return (
      <>
        <PageHeader title="Compare candidates" />
        <Empty>Select 2–4 candidates on the drive page to compare them.</Empty>
      </>
    );
  const rows = await db
    .select({ c: schema.candidacies, cand: schema.candidates, v: schema.driveVersions })
    .from(schema.candidacies)
    .innerJoin(schema.candidates, eq(schema.candidacies.candidateId, schema.candidates.id))
    .innerJoin(schema.driveVersions, eq(schema.candidacies.driveVersionId, schema.driveVersions.id))
    .where(inArray(schema.candidacies.id, ids));
  const people = ids.map((x) => rows.find((r) => r.c.id === x)).filter((r): r is (typeof rows)[number] => !!r && r.c.driveId === id);
  const reports = await db.select().from(schema.roundReports).where(inArray(schema.roundReports.candidacyId, ids));
  const combined = await db.select().from(schema.combinedReports).where(inArray(schema.combinedReports.candidacyId, ids));
  const fits = await db.select().from(schema.practicalFit).where(inArray(schema.practicalFit.candidacyId, ids));
  const config = (people[0]?.v.config ?? drive.draft) as DriveConfig;
  const rounds = enabledRounds(config);

  const comb = (cid: string) => combined.find((x) => x.candidacyId === cid && x.status === "ready");
  const rep = (cid: string, i: number) => reports.find((x) => x.candidacyId === cid && x.roundIndex === i && x.status === "ready");
  const best = (vals: (number | null | undefined)[]) => {
    const nums = vals.filter((v): v is number => v != null);
    return nums.length > 1 ? Math.max(...nums) : null;
  };
  const cols = `minmax(180px,1.2fr) repeat(${people.length}, minmax(160px,1fr))`;

  function Row({ label, cells, sub }: { label: string; cells: React.ReactNode[]; sub?: boolean }) {
    return (
      <div className={cx("grid items-start gap-3 border-b border-slate-100 py-2 text-sm", sub && "text-slate-600")} style={{ gridTemplateColumns: cols }}>
        <div className={cx(sub ? "pl-3 text-xs" : "font-medium")}>{label}</div>
        {cells.map((c, i) => (
          <div key={i}>{c}</div>
        ))}
      </div>
    );
  }

  const finals = people.map((p) => comb(p.c.id)?.finalScore ?? null);
  const bestFinal = best(finals);
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Compare candidates — ${drive.title}`}
        subtitle={
          <Link href={`/app/drives/${id}`} className="text-brand-600 hover:underline">
            ← Back to drive
          </Link>
        }
      />
      {all.length > 4 && <p className="text-sm text-amber-700">Only the first 4 selected candidates are shown.</p>}
      <Card>
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <Row
              label="Candidate"
              cells={people.map((p) => (
                <div key={p.c.id}>
                  <Link href={`/app/candidates/${p.c.id}`} className="font-semibold text-slate-900 hover:text-brand-700">
                    {p.cand.name}
                  </Link>
                  <p className="text-xs text-slate-500">{STAGE_LABEL[p.c.stage] ?? p.c.stage}</p>
                </div>
              ))}
            />
            <Row
              label="Final score"
              cells={people.map((p, i) => (
                <span key={p.c.id} className={cx("text-xl tabular-nums", finals[i] != null && finals[i] === bestFinal ? "font-bold text-slate-900" : "text-slate-700")}>
                  {finals[i] != null ? finals[i]!.toFixed(0) : "—"}
                </span>
              ))}
            />
            <Row
              label="Recommendation"
              cells={people.map((p) => {
                const c = comb(p.c.id);
                return c?.recommendation ? (
                  <Badge key={p.c.id} tone={REC_TONE[c.recommendation as Recommendation]}>
                    {RECOMMENDATION_LABEL[c.recommendation as Recommendation]}
                    {c.partial ? " (partial)" : ""} · {c.confidence}
                  </Badge>
                ) : (
                  "—"
                );
              })}
            />
            {rounds.map((r, i) => {
              const scores = people.map((p) => rep(p.c.id, i)?.roundScore ?? null);
              const b = best(scores);
              return (
                <div key={r.type}>
                  <Row
                    label={ROUND_LABEL[r.type]}
                    cells={people.map((p, j) => {
                      const x = rep(p.c.id, i);
                      return x ? (
                        <span key={p.c.id} className={cx("tabular-nums", scores[j] === b && "font-bold")}>
                          {x.roundScore?.toFixed(0)} · {RECOMMENDATION_LABEL[x.recommendation as Recommendation]}
                        </span>
                      ) : (
                        <span key={p.c.id} className="text-slate-500">
                          not evaluated
                        </span>
                      );
                    })}
                  />
                  {PARAMETERS[r.type]
                    .filter((pp) => (r.weights[pp.id] ?? 0) > 0)
                    .map((pp) => {
                      const vals = people.map((p) => effectiveScore((rep(p.c.id, i)?.params as Record<string, ParamScore> | undefined)?.[pp.id]));
                      const bb = best(vals);
                      return (
                        <Row
                          key={pp.id}
                          sub
                          label={pp.label}
                          cells={vals.map((v, j) => (
                            <span key={j} className={cx("tabular-nums", v != null && v === bb && "font-semibold text-slate-900")}>
                              {v ?? "—"}
                              {v != null && <span className="text-slate-500">/5</span>}
                            </span>
                          ))}
                        />
                      );
                    })}
                </div>
              );
            })}
            <Row
              label="Top strengths"
              cells={people.map((p) => (
                <ul key={p.c.id} className="list-disc space-y-1 pl-4 text-xs">
                  {(((comb(p.c.id)?.data as { strengths?: string[] } | null)?.strengths ?? []) as string[]).slice(0, 3).map((s, k) => (
                    <li key={k}>{s}</li>
                  ))}
                </ul>
              ))}
            />
            <Row
              label="Top risks"
              cells={people.map((p) => (
                <ul key={p.c.id} className="list-disc space-y-1 pl-4 text-xs">
                  {(((comb(p.c.id)?.data as { risks?: string[] } | null)?.risks ?? []) as string[]).slice(0, 3).map((s, k) => (
                    <li key={k}>{s}</li>
                  ))}
                </ul>
              ))}
            />
            <Row
              label="Practical fit"
              cells={people.map((p) => {
                const c = fits.find((f) => f.candidacyId === p.c.id)?.compatibility as Compatibility | null;
                return c ? (
                  <div key={p.c.id} className="space-y-1 text-xs">
                    <Badge tone={FIT_TONE[c.overall]}>{c.overall}</Badge>
                    {c.fields.filter((f) => f.status !== "match").map((f) => (
                      <p key={f.field}>
                        {f.label}: {f.status}
                      </p>
                    ))}
                  </div>
                ) : (
                  "—"
                );
              })}
            />
            <Row
              label="Integrity"
              cells={people.map((p) => {
                const lv = reports
                  .filter((r) => r.candidacyId === p.c.id)
                  .map((r) => (r.roundSpecific as { integrity?: { concern: string } } | null)?.integrity?.concern ?? "none");
                const w = ["high", "medium", "low"].find((x) => lv.includes(x)) ?? (lv.length ? "none" : "—");
                return <span key={p.c.id}>{w}</span>;
              })}
            />
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">Bold marks the highest value in a row. Scores include recruiter overrides.</p>
      </Card>
    </div>
  );
}
