"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Select, Textarea } from "../ui";
import { api } from "../api";

export interface ReviewParam {
  id: string;
  label: string;
  description: string;
  anchors: { 1: string; 3: string; 5: string };
  weight: number;
}

const REC_OPTIONS = [
  ["strong_hire", "Strong Hire"],
  ["hire", "Hire"],
  ["lean_no", "Lean No"],
  ["no_hire", "No Hire"],
] as const;

/** Blind scoring form. The AI's scores are only revealed by the server after the review is saved. */
export function CalibrationReviewForm({ reportId, params }: { reportId: string; params: ReviewParam[] }) {
  const router = useRouter();
  const [scores, setScores] = useState<Record<string, number | null>>({});
  const [rec, setRec] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const unanswered = params.filter((p) => !(p.id in scores)).length;
  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        if (unanswered) return setError(`Score every parameter (or mark it "not enough evidence") — ${unanswered} left.`);
        if (!rec) return setError("Choose your overall recommendation.");
        setBusy(true);
        try {
          await api(`/api/calibration/${reportId}`, { body: { scores, recommendation: rec, notes } });
          router.refresh();
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      {params.map((p) => (
        <fieldset key={p.id} className="rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-sm font-semibold">
            {p.label} <span className="font-normal text-slate-500">· weight {p.weight}%</span>
          </legend>
          <p className="text-sm text-slate-600">{p.description}</p>
          <dl className="mt-2 grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
            {([1, 3, 5] as const).map((n) => (
              <div key={n} className="rounded bg-slate-50 p-2">
                <dt className="font-semibold text-slate-700">{n}</dt>
                <dd>{p.anchors[n]}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label={`${p.label} score`}>
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${scores[p.id] === n ? "border-brand-600 bg-brand-50 font-semibold text-brand-700" : "border-slate-300"}`}>
                <input type="radio" className="sr-only" name={p.id} checked={scores[p.id] === n} onChange={() => setScores({ ...scores, [p.id]: n })} />
                {n}
              </label>
            ))}
            <label className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${p.id in scores && scores[p.id] == null ? "border-slate-600 bg-slate-100 font-semibold" : "border-slate-300 text-slate-600"}`}>
              <input type="radio" className="sr-only" name={p.id} checked={p.id in scores && scores[p.id] == null} onChange={() => setScores({ ...scores, [p.id]: null })} />
              Not enough evidence
            </label>
          </div>
        </fieldset>
      ))}
      <label className="block max-w-xs text-sm">
        <span className="mb-1 block font-semibold">Your overall recommendation for this round</span>
        <Select value={rec} onChange={(e) => setRec(e.target.value)} required>
          <option value="">Choose…</option>
          {REC_OPTIONS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-semibold">Notes (optional)</span>
        <Textarea rows={3} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What drove your scores? Anything the AI is likely to have missed?" />
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Submit and reveal the AI's scores"}
        </Button>
        <Badge>{params.length - unanswered}/{params.length} scored</Badge>
      </div>
    </form>
  );
}
