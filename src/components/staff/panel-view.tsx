import type { ReactNode } from "react";
import { Badge, cx } from "../ui";
import { LocalTime } from "../local-time";
import { RECOMMENDATION_LABEL, type Recommendation } from "@/lib/core/types";
import type { InterviewView } from "@/lib/services/panel";

const STATUS: Record<string, { label: string; tone: "blue" | "amber" | "green" | "slate" | "red" }> = {
  proposed: { label: "waiting for the candidate to pick a time", tone: "amber" },
  scheduled: { label: "booked", tone: "blue" },
  reschedule_requested: { label: "candidate asked for other times", tone: "amber" },
  completed: { label: "completed", tone: "green" },
  cancelled: { label: "cancelled", tone: "slate" },
};

/** One panel interview: booking, panel, and (when the viewer may see them) the scorecards side by side. */
export function PanelInterviewView({ v, actions, showLink }: { v: InterviewView; actions?: ReactNode; showLink?: boolean }) {
  const iv = v.interview;
  const st = STATUS[iv.status] ?? STATUS.scheduled;
  const visible = v.panel.filter((p) => p.card?.submittedAt);
  return (
    <div className="rounded-lg border border-slate-200 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">
          {iv.title} · {iv.durationMin} min <Badge tone={st.tone}>{st.label}</Badge> {v.summary?.split && <Badge tone="amber">panel split</Badge>}
        </p>
        <span className="flex items-center gap-3 text-xs">
          {iv.scheduledAt && iv.status === "scheduled" && (
            <a href={`/api/panel/${iv.id}/ics`} className="text-brand-700 underline" download>
              Calendar file
            </a>
          )}
          {showLink && (
            <a href={`/app/panel/${iv.id}`} className="font-medium text-brand-700 underline">
              Interview kit & scorecard
            </a>
          )}
        </span>
      </div>
      <p className="mt-1 text-slate-700">
        {iv.scheduledAt ? <LocalTime iso={iv.scheduledAt.toISOString()} /> : `${iv.slots.length} time${iv.slots.length === 1 ? "" : "s"} offered`}
        {` · ${iv.location}`}
      </p>
      {iv.status === "reschedule_requested" && iv.candidateMessage && <p className="mt-1 rounded bg-amber-50 p-2 text-amber-900">{`Candidate: “${iv.candidateMessage}”`}</p>}
      <p className="mt-2 text-slate-700">
        Panel:{" "}
        {v.panel.map((p, i) => (
          <span key={p.id}>
            {i > 0 && ", "}
            {p.name} {p.submitted ? <span className="text-emerald-700">✓ scorecard</span> : <span className="text-slate-500">(scorecard pending)</span>}
          </span>
        ))}
      </p>
      {v.othersHidden ? (
        <p className="mt-3 rounded-lg bg-slate-50 p-2 text-slate-700">Submit your own scorecard to see the rest of the panel&apos;s feedback. This keeps each judgement independent.</p>
      ) : (
        visible.length > 0 &&
        v.summary && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Panel ratings by competency</caption>
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-1 pr-3">Competency</th>
                  {visible.map((p) => (
                    <th key={p.id} className="py-1 pr-3">
                      {p.name}
                    </th>
                  ))}
                  <th className="py-1">Average</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {v.summary.competencies.map((c) => (
                  <tr key={c.competency} className={cx(c.split && "bg-amber-50")}>
                    <th scope="row" className="py-1.5 pr-3 text-left font-medium">
                      {c.competency}
                      {c.split && <span className="ml-1 text-xs font-normal text-amber-800">(split)</span>}
                    </th>
                    {visible.map((p) => (
                      <td key={p.id} className="py-1.5 pr-3 tabular-nums">
                        {p.card?.ratings?.[c.competency] ?? "—"}
                      </td>
                    ))}
                    <td className="py-1.5 tabular-nums">{c.mean == null ? "—" : c.mean.toFixed(1)}</td>
                  </tr>
                ))}
                <tr>
                  <th scope="row" className="py-1.5 pr-3 text-left font-semibold">
                    Recommendation
                  </th>
                  {visible.map((p) => (
                    <td key={p.id} className="py-1.5 pr-3 font-medium">
                      {RECOMMENDATION_LABEL[p.card!.recommendation as Recommendation] ?? "—"}
                    </td>
                  ))}
                  <td className="py-1.5 font-semibold">{v.summary.consensus ? RECOMMENDATION_LABEL[v.summary.consensus] : "—"}</td>
                </tr>
              </tbody>
            </table>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {visible.map((p) => (
                <div key={p.id} className="rounded-lg bg-slate-50 p-2">
                  <p className="font-medium">{p.name}</p>
                  {p.card?.strengths && <p className="mt-1 whitespace-pre-wrap">{`+ ${p.card.strengths}`}</p>}
                  {p.card?.concerns && <p className="mt-1 whitespace-pre-wrap">{`− ${p.card.concerns}`}</p>}
                </div>
              ))}
            </div>
          </div>
        )
      )}
      {actions}
    </div>
  );
}
