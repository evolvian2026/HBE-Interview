import Link from "next/link";
import { notFound } from "next/navigation";
import { HttpError, requireStaffPage } from "@/lib/auth/staff";
import { reviewForm } from "@/lib/services/hires";
import { RECOMMENDATION_LABEL } from "@/lib/core/types";
import { Card, PageHeader } from "@/components/ui";
import { HireReviewForm } from "@/components/staff/hires";

export const dynamic = "force-dynamic";

export default async function HireReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaffPage("hiring_manager");
  const { id } = await params;
  const d = await reviewForm(user, id).catch((e) => {
    if (e instanceof HttpError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  const r = d.review;
  return (
    <>
      <Link href="/app/hires" className="text-sm text-brand-600 hover:underline">
        ← Hires
      </Link>
      <PageHeader
        title={`${r.checkpoint}-day check-in: ${d.hire.name}`}
        subtitle={`${d.hire.roleTitle}${d.hire.joinedAt ? ` · joined ${d.hire.joinedAt.toLocaleDateString()}` : ""} · due ${r.dueAt.toLocaleDateString()}. Rate how they're actually doing — the interview results aren't shown here, so they can't colour your answer.`}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Your review" className="lg:col-span-2">
          <HireReviewForm reviewId={r.id} initial={{ rating: r.rating, technical: r.technical, collaboration: r.collaboration, values: r.values, wouldRehire: r.wouldRehire, note: r.note ?? "" }} />
        </Card>
        <Card title="What the interview said">
          {d.snapshot ? (
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-xs text-slate-600">AI recommendation</dt>
                <dd>{d.snapshot.aiRecommendation ? RECOMMENDATION_LABEL[d.snapshot.aiRecommendation] : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-600">Final interview score</dt>
                <dd>{d.snapshot.finalScore ?? "—"}</dd>
              </div>
              {Object.entries(d.snapshot.roundScores).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-slate-600">{`${k[0].toUpperCase()}${k.slice(1)} round`}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
              {d.snapshot.panelHireShare != null && (
                <div>
                  <dt className="text-xs text-slate-600">Panel votes to hire</dt>
                  <dd>{`${Math.round(d.snapshot.panelHireShare * 100)}%`}</dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="text-sm text-slate-600">Shown after you submit your review.</p>
          )}
        </Card>
      </div>
    </>
  );
}
