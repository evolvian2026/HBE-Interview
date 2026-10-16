"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Textarea } from "../ui";
import { api } from "../api";

interface Summary {
  strengths: string[];
  growthAreas: string[];
  note: string;
}

const toLines = (s: string) =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

/** Recruiter workflow: AI drafts candidate-facing feedback → recruiter edits → release to the candidate's page. */
export function CandidateFeedbackPanel({
  candidacyId,
  canEdit,
  canDraft,
  initial,
  releasedAt,
  surveys,
}: {
  candidacyId: string;
  canEdit: boolean;
  canDraft: boolean;
  initial: Summary | null;
  releasedAt: string | null;
  surveys: { round: string; overall: number; fairness: number | null; clarity: number | null; technical: number | null; comment: string | null }[];
}) {
  const router = useRouter();
  const [s, setS] = useState({ strengths: initial?.strengths.join("\n") ?? "", growth: initial?.growthAreas.join("\n") ?? "", note: initial?.note ?? "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const body = (release: boolean) => ({ summary: { strengths: toLines(s.strengths), growthAreas: toLines(s.growth), note: s.note.trim() }, release });
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      title="Candidate feedback"
      actions={releasedAt ? <Badge tone="green">Released {new Date(releasedAt).toLocaleDateString()}</Badge> : initial ? <Badge tone="amber">Draft — not visible to candidate</Badge> : null}
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            Developmental feedback shown on the candidate&apos;s page once released. It never includes scores, recommendations or integrity signals. Review every line before releasing.
          </p>
          {canEdit ? (
            <>
              <label className="block text-sm">
                <span className="font-medium">What went well</span> <span className="text-xs text-slate-400">(one per line)</span>
                <Textarea rows={3} value={s.strengths} onChange={(e) => setS({ ...s, strengths: e.target.value })} />
              </label>
              <label className="block text-sm">
                <span className="font-medium">Areas to develop</span> <span className="text-xs text-slate-400">(one per line)</span>
                <Textarea rows={3} value={s.growth} onChange={(e) => setS({ ...s, growth: e.target.value })} />
              </label>
              <label className="block text-sm">
                <span className="font-medium">Closing note</span>
                <Textarea rows={2} value={s.note} onChange={(e) => setS({ ...s, note: e.target.value })} />
              </label>
              <div className="flex flex-wrap gap-2">
                {canDraft && (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const r = await api<{ summary: Summary }>(`/api/candidacies/${candidacyId}/feedback`, { method: "POST" });
                        setS({ strengths: r.summary.strengths.join("\n"), growth: r.summary.growthAreas.join("\n"), note: r.summary.note });
                      })
                    }
                  >
                    {initial ? "Re-draft with AI" : "Draft with AI"}
                  </Button>
                )}
                <Button variant="secondary" disabled={busy || !s.strengths.trim()} onClick={() => run(() => api(`/api/candidacies/${candidacyId}/feedback`, { method: "PUT", body: body(false) }))}>
                  {releasedAt ? "Withdraw" : "Save draft"}
                </Button>
                <Button
                  disabled={busy || !s.strengths.trim()}
                  onClick={() => confirm("Release this feedback to the candidate? They will see it on their interview page.") && run(() => api(`/api/candidacies/${candidacyId}/feedback`, { method: "PUT", body: body(true) }))}
                >
                  {releasedAt ? "Update released feedback" : "Release to candidate"}
                </Button>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
            </>
          ) : initial ? (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {[...initial.strengths, ...initial.growthAreas].map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No feedback drafted yet.</p>
          )}
        </div>
        <div>
          <p className="text-sm font-medium">Candidate experience survey</p>
          {surveys.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500">No responses yet.</p>
          ) : (
            <table className="mt-2 w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-1">Round</th>
                  <th>Overall</th>
                  <th>Fair</th>
                  <th>Clear</th>
                  <th>Tools</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {surveys.map((r, i) => (
                  <tr key={i}>
                    <td className="py-1">
                      {r.round}
                      {r.comment && <p className="text-xs text-slate-500">“{r.comment}”</p>}
                    </td>
                    <td>{r.overall}/5</td>
                    <td>{r.fairness ?? "—"}</td>
                    <td>{r.clarity ?? "—"}</td>
                    <td>{r.technical ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-xs text-slate-500">Ratings are context for improving the process — they are never shown to the evaluator and don&apos;t affect scores.</p>
        </div>
      </div>
    </Card>
  );
}
