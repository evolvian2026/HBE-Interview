import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, ne, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { HttpError, requireStaffPage } from "@/lib/auth/staff";
import { interviewKit } from "@/lib/services/panel";
import { RECOMMENDATION_LABEL } from "@/lib/core/types";
import { Card, PageHeader } from "@/components/ui";
import { PanelInterviewView } from "@/components/staff/panel-view";
import { ScorecardForm } from "@/components/staff/scorecard-form";

export const dynamic = "force-dynamic";

export default async function InterviewKitPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaffPage("hiring_manager");
  const { id } = await params;
  let kit: Awaited<ReturnType<typeof interviewKit>>;
  try {
    kit = await interviewKit(user, id);
  } catch (e) {
    if (e instanceof HttpError) notFound();
    throw e;
  }
  const iv = kit.interview;
  const [finalDecision] = await db
    .select({ id: schema.hiringDecisions.id })
    .from(schema.hiringDecisions)
    .where(and(eq(schema.hiringDecisions.candidacyId, iv.candidacyId), ne(schema.hiringDecisions.decision, "hold"), sql`${schema.hiringDecisions.createdAt} > ${iv.createdAt}`));
  const notStarted = !iv.scheduledAt || iv.scheduledAt.getTime() > Date.now();
  const locked = iv.status === "cancelled" ? "This interview was cancelled." : !["scheduled", "completed"].includes(iv.status) ? "The scorecard opens once the interview is booked and has started." : notStarted ? "The scorecard opens when the interview starts." : finalDecision ? "A final decision has been recorded, so scorecards are locked." : undefined;
  return (
    <>
      <PageHeader
        title={`Interview kit: ${kit.candidate.name}`}
        subtitle={`${kit.candidate.driveTitle} · ${iv.title}`}
        actions={
          <Link href={`/app/candidates/${kit.candidate.candidacyId}`} className="rounded-lg px-3.5 py-2 text-sm text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">
            Full candidate report
          </Link>
        }
      />
      <div className="space-y-6">
        <PanelInterviewView v={kit} />
        <Card title="What to explore (from the AI interviews)">
          <div className="grid gap-6 text-sm md:grid-cols-2">
            <div>
              <p>{kit.ai.recommendation ? `AI combined recommendation: ${RECOMMENDATION_LABEL[kit.ai.recommendation]} (${kit.ai.finalScore?.toFixed(0) ?? "—"}/100).` : "No combined AI report yet."}</p>
              {kit.ai.summary && <p className="mt-2 text-slate-700">{kit.ai.summary}</p>}
              <p className="mt-2 text-xs text-slate-600">The AI&apos;s view is advisory. Score what you see in your interview.</p>
            </div>
            <div className="space-y-3">
              {kit.ai.focusAreas.length > 0 && (
                <div>
                  <h3 className="font-semibold">Focus areas</h3>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {kit.ai.focusAreas.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}
              {kit.ai.risks.length > 0 && (
                <div>
                  <h3 className="font-semibold">Risks to probe</h3>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {kit.ai.risks.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}
              {kit.ai.candidateQuestions.length > 0 && (
                <div>
                  <h3 className="font-semibold">Questions the candidate asked that need a person</h3>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {kit.ai.candidateQuestions.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </Card>
        {kit.isPanelist && (
          <Card title="Your scorecard">
            <ScorecardForm
              interviewId={iv.id}
              competencies={iv.competencies}
              locked={locked}
              initial={{ ratings: kit.mine?.ratings ?? null, recommendation: kit.mine?.recommendation ?? null, strengths: kit.mine?.strengths ?? null, concerns: kit.mine?.concerns ?? null, submitted: !!kit.mine?.submittedAt }}
            />
          </Card>
        )}
      </div>
    </>
  );
}
