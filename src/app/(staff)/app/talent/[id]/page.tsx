import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { HttpError, canSeeDrive, requireStaffPage } from "@/lib/auth/staff";
import { talentProfile } from "@/lib/services/talent";
import { RECOMMENDATION_LABEL, type Recommendation } from "@/lib/core/types";
import { Badge, Card, PageHeader } from "@/components/ui";
import { REC_TONE, STAGE_LABEL, STAGE_TONE } from "@/components/labels";
import { ReinviteForm, TagEditor } from "@/components/staff/talent-actions";

export const dynamic = "force-dynamic";

export default async function TalentProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaffPage("recruiter");
  const { id } = await params;
  let p: Awaited<ReturnType<typeof talentProfile>>;
  try {
    p = await talentProfile(user, id);
  } catch (e) {
    if (e instanceof HttpError) notFound();
    throw e;
  }
  const appliedTo = new Set(p.applications.map((a) => a.d.id));
  const drives = (await db.select().from(schema.drives).where(and(eq(schema.drives.orgId, user.orgId), eq(schema.drives.status, "active")))).filter((d) => canSeeDrive(user, d) && !appliedTo.has(d.id));
  return (
    <>
      <PageHeader
        title={p.candidate.name}
        subtitle={`${p.candidate.email}${p.profile?.location ? ` · ${p.profile.location}` : ""}`}
        actions={
          <Link href="/app/talent" className="rounded-lg px-3.5 py-2 text-sm text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">
            Back to search
          </Link>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title={`Applications (${p.applications.length})`}>
            <ul className="divide-y divide-slate-100 text-sm">
              {p.applications.map((a) => (
                <li key={a.c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <b>{a.d.title}</b> <span className="text-slate-500">{`· ${a.c.createdAt.toLocaleDateString()}${a.c.source ? ` · via ${a.c.source}` : ""}`}</span>{" "}
                    <Badge tone={STAGE_TONE[a.c.stage] ?? "slate"}>{STAGE_LABEL[a.c.stage] ?? a.c.stage}</Badge> {a.rec && <Badge tone={REC_TONE[a.rec as Recommendation]}>{`AI: ${RECOMMENDATION_LABEL[a.rec as Recommendation]} · ${a.score?.toFixed(0) ?? "—"}`}</Badge>}{" "}
                    {a.decision && <Badge tone={a.decision.decision === "offer" ? "green" : a.decision.decision === "reject" ? "red" : "amber"}>{`decision: ${a.decision.decision}`}</Badge>}
                  </span>
                  {a.visible && (
                    <Link href={`/app/candidates/${a.c.id}`} className="text-brand-600 hover:underline">
                      Report
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </Card>
          {p.profile && (
            <Card title="Profile (latest resume)">
              {p.profile.summary && <p className="text-sm">{p.profile.summary}</p>}
              {p.profile.experience.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm">
                  {p.profile.experience.slice(0, 5).map((e, i) => (
                    <li key={i}>{`${e.title} — ${e.company}${e.start ? ` (${e.start}–${e.end || "present"})` : ""}`}</li>
                  ))}
                </ul>
              )}
              {p.profile.skills.length > 0 && <p className="mt-3 text-xs text-slate-600">{`Skills: ${p.profile.skills.map((s) => s.name).slice(0, 30).join(", ")}`}</p>}
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <Card title="Talent pool">
            {p.inPool ? (
              <p className="text-sm">{`In the talent pool until ${p.candidate.poolExpiresAt!.toLocaleDateString()} (joined ${p.candidate.poolConsentAt?.toLocaleDateString() ?? "—"}).`}</p>
            ) : (
              <p className="text-sm text-slate-600">Not in the talent pool. They haven&apos;t agreed to be contacted about other roles, so they can&apos;t be invited from here.</p>
            )}
            {p.inPool && (
              <div className="mt-3">
                <ReinviteForm candidateId={p.candidate.id} drives={drives.map((d) => ({ id: d.id, title: d.title }))} />
              </div>
            )}
          </Card>
          <Card title="Tags">
            <TagEditor candidateId={p.candidate.id} initial={p.candidate.tags} />
          </Card>
        </div>
      </div>
    </>
  );
}
