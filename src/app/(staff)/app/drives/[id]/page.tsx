import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { requireDrivePage, hasRole, requireStaffPage } from "@/lib/auth/staff";
import { env } from "@/lib/env";
import { enabledRounds } from "@/lib/core/rounds";
import { CATEGORY_LABEL, RECOMMENDATION_LABEL, ROUND_LABEL, SENIORITY_LABEL, type DriveConfig, type Recommendation } from "@/lib/core/types";
import { Badge, Card, Empty, LinkButton, PageHeader } from "@/components/ui";
import { FIT_TONE, REC_TONE, STAGE_LABEL, STAGE_TONE } from "@/components/labels";
import { DriveActions } from "@/components/staff/drive-actions";
import { InviteForm } from "@/components/staff/invite-form";
import { CopyButton } from "@/components/staff/copy-button";

export const dynamic = "force-dynamic";

const STATUS_TONE = { draft: "slate", active: "green", paused: "amber", closed: "slate" } as const;
const STAGES = ["all", "invited", "onboarding", "in_round", "evaluating", "gate_pending", "round_available", "completed", "shortlisted", "rejected", "on_hold", "expired"];

export default async function DrivePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ stage?: string; sort?: string }> }) {
  const user = await requireStaffPage();
  const { id } = await params;
  const { stage = "all", sort = "recent" } = await searchParams;
  const d = await requireDrivePage(user, id);
  const [version] = d.currentVersionId ? await db.select().from(schema.driveVersions).where(eq(schema.driveVersions.id, d.currentVersionId)) : [];
  const config = (version?.config ?? d.draft) as DriveConfig;
  const rounds = enabledRounds(config);

  const rows = await db
    .select({ c: schema.candidacies, cand: schema.candidates })
    .from(schema.candidacies)
    .innerJoin(schema.candidates, eq(schema.candidacies.candidateId, schema.candidates.id))
    .where(eq(schema.candidacies.driveId, id))
    .orderBy(desc(schema.candidacies.updatedAt));
  const ids = rows.map((r) => r.c.id);
  const reports = ids.length ? await db.select().from(schema.roundReports).where(inArray(schema.roundReports.candidacyId, ids)) : [];
  const combined = ids.length ? await db.select().from(schema.combinedReports).where(inArray(schema.combinedReports.candidacyId, ids)) : [];
  const fits = ids.length ? await db.select().from(schema.practicalFit).where(inArray(schema.practicalFit.candidacyId, ids)) : [];

  const byStage: Record<string, number> = {};
  for (const r of rows) byStage[r.c.stage] = (byStage[r.c.stage] ?? 0) + 1;
  let list = rows.filter((r) => stage === "all" || r.c.stage === stage);
  const finalOf = (cid: string) => combined.find((x) => x.candidacyId === cid);
  if (sort === "score") list = [...list].sort((a, b) => (finalOf(b.c.id)?.finalScore ?? -1) - (finalOf(a.c.id)?.finalScore ?? -1));
  const openLink = `${env.appBaseUrl.replace(/\/$/, "")}/i/${d.openSlug}`;

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {d.title} <Badge tone={STATUS_TONE[d.status]}>{d.status}</Badge>
            {version && <Badge>v{version.version}</Badge>}
          </span>
        }
        subtitle={`${CATEGORY_LABEL[config.roleProfile.category]} · ${SENIORITY_LABEL[config.roleProfile.seniority]} · ${rounds.map((r) => ROUND_LABEL[r.type]).join(" → ")}`}
        actions={
          hasRole(user, "recruiter") && (
            <>
              <LinkButton variant="secondary" href={`/app/drives/${d.id}/analytics`}>
                Analytics
              </LinkButton>
              <LinkButton variant="secondary" href={`/app/drives/${d.id}/fairness`}>
                Fairness
              </LinkButton>
              <LinkButton variant="secondary" href={`/app/drives/${d.id}/edit`}>
                Configure
              </LinkButton>
              {config.roleProfile.category === "coding" && (
                <LinkButton variant="secondary" href={`/app/drives/${d.id}/problems`}>
                  Coding problems
                </LinkButton>
              )}
              <DriveActions driveId={d.id} status={d.status} published={!!d.currentVersionId} />
            </>
          )
        }
      />

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card title="Open invite link" className="lg:col-span-1">
          {d.status === "active" ? (
            <>
              <p className="break-all rounded-lg bg-slate-50 p-2 font-mono text-xs">{openLink}</p>
              <div className="mt-2 flex gap-2">
                <CopyButton text={openLink} />
              </div>
              <p className="mt-2 text-xs text-slate-500">Anyone with this link can register. Each candidate gets a personal link after registering.</p>
            </>
          ) : (
            <p className="text-sm text-slate-500">Publish and activate the drive to get an invite link.</p>
          )}
        </Card>
        <Card title="Invite candidates" className="lg:col-span-2">
          {d.status === "active" && hasRole(user, "recruiter") ? <InviteForm driveId={d.id} /> : <p className="text-sm text-slate-500">Available when the drive is active.</p>}
        </Card>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        {STAGES.filter((s) => s === "all" || byStage[s]).map((s) => (
          <Link key={s} href={`/app/drives/${d.id}?stage=${s}&sort=${sort}`} className={`rounded-full px-3 py-1 ${stage === s ? "bg-brand-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"}`}>
            {s === "all" ? "All" : STAGE_LABEL[s]} {s === "all" ? rows.length : byStage[s]}
          </Link>
        ))}
        <span className="ml-auto text-slate-500">
          Sort:{" "}
          <Link className={sort === "recent" ? "font-medium text-slate-900" : "text-brand-600"} href={`/app/drives/${d.id}?stage=${stage}&sort=recent`}>
            recent
          </Link>{" "}
          ·{" "}
          <Link className={sort === "score" ? "font-medium text-slate-900" : "text-brand-600"} href={`/app/drives/${d.id}?stage=${stage}&sort=score`}>
            final score
          </Link>
        </span>
      </div>

      {list.length === 0 ? (
        <Empty>No candidates {stage !== "all" ? "in this stage" : "yet"}.</Empty>
      ) : (
        <form method="get" action={`/app/drives/${d.id}/compare`}>
        <div className="mb-2 flex justify-end">
          <button type="submit" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50">
            Compare selected (2–4)
          </button>
        </div>
        <Card className="overflow-hidden">
          <div className="-m-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="w-8 py-3 pl-5"><span className="sr-only">Select</span></th>
                  <th className="px-3 py-3">Candidate</th>
                  <th className="px-3 py-3">Stage</th>
                  {rounds.map((r) => (
                    <th key={r.type} className="px-3 py-3 text-right">
                      {r.type === "technical" ? "Technical" : r.type === "managerial" ? "Managerial" : "HR"}
                    </th>
                  ))}
                  <th className="px-3 py-3 text-right">Final</th>
                  <th className="px-3 py-3">Recommendation</th>
                  <th className="px-3 py-3">Practical fit</th>
                  <th className="px-5 py-3">Integrity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map(({ c, cand }) => {
                  const fin = finalOf(c.id);
                  const fit = fits.find((f) => f.candidacyId === c.id)?.compatibility as { overall?: string } | null;
                  const integ = reports
                    .filter((r) => r.candidacyId === c.id)
                    .map((r) => (r.roundSpecific as { integrity?: { concern: string } } | null)?.integrity?.concern ?? "none");
                  const worst = ["high", "medium", "low"].find((x) => integ.includes(x)) ?? (integ.length ? "none" : "");
                  return (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="py-3 pl-5">
                        <input type="checkbox" name="ids" value={c.id} aria-label={`Select ${cand.name} for comparison`} />
                      </td>
                      <td className="px-3 py-3">
                        <Link href={`/app/candidates/${c.id}`} className="font-medium hover:text-brand-700">
                          {cand.name}
                        </Link>
                        <p className="text-xs text-slate-500">{cand.email}</p>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={STAGE_TONE[c.stage] ?? "slate"}>{STAGE_LABEL[c.stage] ?? c.stage}</Badge>
                      </td>
                      {rounds.map((_, i) => {
                        const r = reports.find((x) => x.candidacyId === c.id && x.roundIndex === i);
                        return (
                          <td key={i} className="px-3 py-3 text-right tabular-nums">
                            {r?.status === "ready" ? (
                              <span title={RECOMMENDATION_LABEL[r.recommendation as Recommendation]}>{r.roundScore?.toFixed(0)}</span>
                            ) : r ? (
                              <span className="text-xs text-slate-500">{r.status === "failed" ? "failed" : "…"}</span>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-3 py-3 text-right font-medium tabular-nums">{fin?.finalScore != null ? fin.finalScore.toFixed(0) : "—"}</td>
                      <td className="px-3 py-3">
                        {fin?.recommendation ? (
                          <Badge tone={REC_TONE[fin.recommendation as Recommendation]}>
                            {RECOMMENDATION_LABEL[fin.recommendation as Recommendation]}
                            {fin.partial ? " (partial)" : ""}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-3">{fit?.overall ? <Badge tone={FIT_TONE[fit.overall]}>{fit.overall}</Badge> : "—"}</td>
                      <td className="px-5 py-3">{worst ? <Badge tone={worst === "high" ? "red" : worst === "medium" ? "amber" : "slate"}>{worst}</Badge> : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
        </form>
      )}
    </>
  );
}
