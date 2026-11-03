import Link from "next/link";
import { notFound } from "next/navigation";
import { HttpError, requireStaffPage } from "@/lib/auth/staff";
import { caseDetail, expectedRoundScore } from "@/lib/services/benchmark";
import { PARAMETERS } from "@/lib/core/rubrics";
import { RECOMMENDATION_LABEL, ROUND_LABEL, type Recommendation } from "@/lib/core/types";
import type { Expected } from "@/lib/core/benchmark";
import { Badge, Card, PageHeader } from "@/components/ui";
import { CaseEditor } from "@/components/staff/test-bench";

export const dynamic = "force-dynamic";

const SOURCE: Record<string, string> = { calibration: "a blind review by your team", override: "the AI's scores with your team's overrides", ai: "the AI's own scores — confirm or correct them", manual: "your team" };
const rec = (r: string | null | undefined) => (r ? (RECOMMENDATION_LABEL[r as Recommendation] ?? r) : "—");

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaffPage("admin");
  const { id } = await params;
  const d = await caseDetail(user, id).catch((e) => {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  });
  const c = d.case;
  const expected = c.expected as Expected;
  const paramDefs = PARAMETERS[c.roundType].filter((p) => (d.bundle.weights[p.id] ?? 0) > 0).map((p) => ({ id: p.id, label: p.label }));
  const labelOf = (pid: string) => paramDefs.find((p) => p.id === pid)?.label ?? pid;
  const written = !c.candidacyId;

  return (
    <>
      <Link href="/app/test-bench" className="text-sm text-brand-600 hover:underline">
        ← Test bench
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {c.title}
            <Badge>{ROUND_LABEL[c.roundType]}</Badge>
            {written ? <Badge>written</Badge> : <Badge tone="blue">from a real round</Badge>}
            {!c.active && <Badge tone="amber">left out of runs</Badge>}
          </span>
        }
        subtitle={
          written
            ? "Written by your team — contains no candidate data and is kept until you delete it."
            : "An anonymised copy of what the evaluator read for a real round (name, email and links removed). It is deleted automatically with the candidate's data (retention period or a deletion request)."
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card title="What the evaluator reads">
            <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">Transcript</h3>
            <pre tabIndex={0} aria-label="Transcript" className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs leading-relaxed">{d.bundle.transcriptText}</pre>
            {d.bundle.artifactsText && (
              <>
                <h3 className="mb-1 mt-4 text-xs font-semibold uppercase text-slate-500">Exercises and code</h3>
                <pre tabIndex={0} aria-label="Exercises and code" className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs">{d.bundle.artifactsText}</pre>
              </>
            )}
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Expected scores">
            <p className="mb-3 text-sm text-slate-600">{`Currently from ${SOURCE[c.expectedSource]}. Expected round score: ${expectedRoundScore(expected, d.bundle.weights) ?? "—"}.`}</p>
            <CaseEditor caseId={c.id} params={paramDefs} expected={expected} notes={c.notes ?? ""} active={c.active} title={c.title} />
          </Card>
          {c.original && (
            <Card title="The AI's result on the live round">
              <p className="text-sm">{`${rec(c.original.recommendation)} · ${c.original.score ?? "—"}${c.original.evaluator ? ` · ${c.original.evaluator}` : ""}`}</p>
              <p className="mt-1 text-xs text-slate-600">{Object.entries(c.original.params).map(([k, v]) => `${labelOf(k)} ${v ?? "—"}`).join(" · ")}</p>
            </Card>
          )}
          <Card title="Results in past runs">
            {d.history.length === 0 ? (
              <p className="text-sm text-slate-500">Not scored in a run yet.</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2 pr-3">Run</th>
                    <th className="py-2 pr-3">AI</th>
                    <th className="py-2">Parameters</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {d.history.map(({ result: r, run }) => (
                    <tr key={r.id}>
                      <td className="py-2 pr-3 align-top">
                        <Link href={`/app/test-bench/runs/${run.id}`} className="text-brand-600 hover:underline">
                          {run.label}
                        </Link>
                        <span className="block text-xs text-slate-500">{`${run.model}${r.repeat > 1 ? ` · #${r.repeat}` : ""}`}</span>
                      </td>
                      <td className="py-2 pr-3 align-top">{`${rec(r.recommendation)} · ${r.roundScore ?? "—"}`}</td>
                      <td className="py-2 align-top text-xs">{Object.entries(r.params ?? {}).map(([k, v]) => `${labelOf(k)} ${v ?? "—"}`).join(" · ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
