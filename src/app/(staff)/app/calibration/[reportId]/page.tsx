import Link from "next/link";
import { notFound } from "next/navigation";
import { HttpError, requireStaffPage } from "@/lib/auth/staff";
import { blindPacket, reviewResult } from "@/lib/services/calibration";
import { RECOMMENDATION_LABEL, ROUND_LABEL, type Recommendation } from "@/lib/core/types";
import { Badge, Card, PageHeader, cx } from "@/components/ui";
import { CalibrationReviewForm } from "@/components/staff/calibration-review-form";

export const dynamic = "force-dynamic";

export default async function BlindReviewPage({ params }: { params: Promise<{ reportId: string }> }) {
  const user = await requireStaffPage("hiring_manager");
  const { reportId } = await params;
  let packet: Awaited<ReturnType<typeof blindPacket>>;
  try {
    packet = await blindPacket(user, reportId);
  } catch (e) {
    if (e instanceof HttpError && e.status !== 409) notFound();
    throw e;
  }
  const done = packet.alreadyReviewed ? await reviewResult(user, reportId) : null;

  if (done) {
    const { review, comparison, labels } = done;
    return (
      <>
        <PageHeader
          title={`Your review: ${packet.alias}`}
          subtitle={`${packet.driveTitle} · ${ROUND_LABEL[packet.roundType]}`}
          actions={
            <Link href="/app/calibration" className="rounded-lg px-3.5 py-2 text-sm text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">
              Back to calibration
            </Link>
          }
        />
        <Card title={<span className="flex items-center gap-2">You and the AI {comparison.disagrees ? <Badge tone="amber">disagreement</Badge> : <Badge tone="green">in agreement</Badge>}</span>}>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2 pr-3">Parameter</th>
                <th className="py-2 pr-3">You</th>
                <th className="py-2 pr-3">AI</th>
                <th className="py-2">Gap</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {Object.entries(review.scores).map(([id, h]) => {
                const ai = review.ai.scores[id];
                const gap = typeof ai === "number" ? Math.abs(h - ai) : null;
                return (
                  <tr key={id}>
                    <td className="py-2 pr-3 font-medium">{labels[id] ?? id}</td>
                    <td className="py-2 pr-3 tabular-nums">{h}/5</td>
                    <td className="py-2 pr-3 tabular-nums">{typeof ai === "number" ? `${ai}/5` : "not scored"}</td>
                    <td className={cx("py-2 tabular-nums", gap != null && gap >= 2 ? "font-semibold text-red-700" : "text-slate-600")}>{gap ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-4 text-sm">
            Recommendation: you <b>{RECOMMENDATION_LABEL[review.recommendation as Recommendation]}</b>, AI <b>{RECOMMENDATION_LABEL[review.ai.recommendation as Recommendation]}</b>
            {comparison.recommendationFlip && <span className="text-red-700"> — on different sides of the hire line</span>}.
          </p>
          {!review.blind && <p className="mt-2 text-xs text-amber-800">You had opened this candidate&apos;s full report before reviewing, so this review is excluded from blind agreement statistics by default.</p>}
          {review.notes && <p className="mt-2 text-sm text-slate-600">Your notes: {review.notes}</p>}
          <p className="mt-4 text-sm">
            <Link href={`/app/candidates/${packet.candidacyId}`} className="font-medium text-brand-600 hover:underline">
              Open the full report →
            </Link>
          </p>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`Blind review: ${packet.alias}`}
        subtitle={`${packet.driveTitle} · ${ROUND_LABEL[packet.roundType]}. Score from the evidence below. The AI's scores, summary and flags are hidden until you submit, and the candidate's name is hidden to reduce bias.`}
      />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card title="Role">
            <p className="text-sm">{packet.roleSummary}</p>
            {packet.mustHaveSkills.length > 0 && <p className="mt-2 text-xs text-slate-600">Must-have skills: {packet.mustHaveSkills.join(", ")}</p>}
          </Card>
          {packet.code && (
            <Card title={`Code (${packet.code.final ? "final submission" : "last snapshot, not submitted"} · ${packet.code.language})`}>
              {packet.code.total != null && (
                <p className="mb-2 text-sm">
                  Hidden tests passed: <b>{packet.code.passed}/{packet.code.total}</b>
                </p>
              )}
              <pre className="max-h-96 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{packet.code.code}</pre>
            </Card>
          )}
          {packet.written.map((w, i) => (
            <Card key={i} title={`Written ${w.kind.replace("_", " ")} response`}>
              <dl className="space-y-2 text-sm">
                {Object.entries(w.content)
                  .filter(([, v]) => typeof v === "string" && v.trim())
                  .map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-xs font-medium uppercase text-slate-500">{k}</dt>
                      <dd className="whitespace-pre-wrap">{v}</dd>
                    </div>
                  ))}
              </dl>
              {w.whiteboard && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`data:image/png;base64,${w.whiteboard}`} alt="Candidate's system design whiteboard" className="mt-2 w-full rounded border border-slate-200" />
              )}
            </Card>
          ))}
          <Card title={`Transcript (${packet.transcript.length} messages)`}>
            <ol className="max-h-[48rem] space-y-2 overflow-auto text-sm">
              {packet.transcript.map((m) => (
                <li key={m.seq} className={cx("rounded-lg p-2", m.role === "candidate" ? "bg-brand-50/50" : "bg-slate-50")}>
                  <span className="mr-2 font-mono text-[10px] text-slate-500">M{m.seq}</span>
                  <span className="text-xs font-medium text-slate-500">
                    {m.role === "ai" ? `${packet.personaName} (AI)` : "Candidate"} · {m.sectionKey}
                  </span>
                  <p className="mt-1 whitespace-pre-wrap">{m.content}</p>
                </li>
              ))}
            </ol>
          </Card>
        </div>
        <div className="lg:col-span-2">
          <div className="lg:sticky lg:top-20">
            <Card title="Your scores">
              <CalibrationReviewForm reportId={packet.reportId} params={packet.parameters} />
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
