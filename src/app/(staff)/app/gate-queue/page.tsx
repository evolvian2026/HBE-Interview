import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { canSeeDrive, requireStaffPage } from "@/lib/auth/staff";
import { ROUND_LABEL, RECOMMENDATION_LABEL, type Recommendation, type RoundType } from "@/lib/core/types";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { REC_TONE } from "@/components/labels";

export const dynamic = "force-dynamic";

export default async function GateQueuePage() {
  const user = await requireStaffPage();
  const allRows = await db
    .select({ c: schema.candidacies, cand: schema.candidates, d: schema.drives })
    .from(schema.candidacies)
    .innerJoin(schema.candidates, eq(schema.candidacies.candidateId, schema.candidates.id))
    .innerJoin(schema.drives, eq(schema.candidacies.driveId, schema.drives.id))
    .where(inArray(schema.candidacies.stage, ["gate_pending", "on_hold"]))
    .orderBy(desc(schema.candidacies.updatedAt));
  const rows = allRows.filter((r) => canSeeDrive(user, r.d.id));
  const ids = rows.map((r) => r.c.id);
  const reports = ids.length ? await db.select().from(schema.roundReports).where(inArray(schema.roundReports.candidacyId, ids)) : [];
  const auto = await db
    .select({ g: schema.gateDecisions, cand: schema.candidates, c: schema.candidacies })
    .from(schema.gateDecisions)
    .innerJoin(schema.candidacies, eq(schema.gateDecisions.candidacyId, schema.candidacies.id))
    .innerJoin(schema.candidates, eq(schema.candidacies.candidateId, schema.candidates.id))
    .where(and(eq(schema.gateDecisions.mode, "auto")))
    .orderBy(desc(schema.gateDecisions.createdAt))
    .limit(20);
  return (
    <>
      <PageHeader title="Decisions" subtitle="Candidates whose last round needs a human decision before the next round unlocks." />
      {rows.length === 0 ? (
        <Empty>Nothing waiting for a decision.</Empty>
      ) : (
        <div className="space-y-3">
          {rows.map(({ c, cand, d }) => {
            const rep = reports.find((r) => r.candidacyId === c.id && r.roundIndex === c.currentRoundIndex);
            return (
              <Card key={c.id}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <Link href={`/app/candidates/${c.id}`} className="font-medium hover:text-brand-700">
                      {cand.name}
                    </Link>
                    <p className="text-xs text-slate-500">
                      {d.title} · after round {c.currentRoundIndex + 1}
                      {rep ? ` (${ROUND_LABEL[rep.roundType as RoundType]})` : ""} {c.stage === "on_hold" && "· on hold"}
                    </p>
                    {rep?.status === "ready" && (
                      <div className="mt-2 space-y-1 text-sm">
                        <p className="text-slate-700">{rep.summary}</p>
                        <p className="text-xs text-emerald-700">+ {((rep.strengths as string[]) ?? [])[0]}</p>
                        <p className="text-xs text-red-700">− {((rep.concerns as string[]) ?? [])[0]}</p>
                      </div>
                    )}
                  </div>
                  {rep?.status === "ready" && (
                    <div className="text-right">
                      <p className="text-2xl font-semibold tabular-nums">{rep.roundScore?.toFixed(0)}</p>
                      <Badge tone={REC_TONE[rep.recommendation as Recommendation]}>{RECOMMENDATION_LABEL[rep.recommendation as Recommendation]}</Badge>
                    </div>
                  )}
                </div>
                <Link href={`/app/candidates/${c.id}`} className="mt-3 inline-block text-sm font-medium text-brand-600 hover:underline">
                  Open report and decide →
                </Link>
              </Card>
            );
          })}
        </div>
      )}
      <h2 className="mb-3 mt-10 text-sm font-semibold text-slate-700">Recently auto-advanced</h2>
      {auto.filter((a) => canSeeDrive(user, a.c.driveId)).length === 0 ? (
        <p className="text-sm text-slate-500">None yet.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {auto.filter((a) => canSeeDrive(user, a.c.driveId)).map(({ g, cand, c }) => (
            <li key={g.id}>
              <Link href={`/app/candidates/${c.id}`} className="text-brand-700 hover:underline">
                {cand.name}
              </Link>{" "}
              — after round {g.fromRoundIndex + 1} · {g.reason} · {g.createdAt.toLocaleString()}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
