"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Select, Textarea } from "../ui";
import { api } from "../api";

const RECS = [
  ["strong_hire", "Strong Hire"],
  ["hire", "Hire"],
  ["lean_no", "Lean No"],
  ["no_hire", "No Hire"],
] as const;

export interface ScorecardValue {
  ratings: Record<string, number> | null;
  recommendation: string | null;
  strengths: string | null;
  concerns: string | null;
  submitted: boolean;
}

/** A panelist's scorecard: 1–5 per competency (or not assessed), recommendation, strengths and concerns. */
export function ScorecardForm({ interviewId, competencies, initial, locked }: { interviewId: string; competencies: string[]; initial: ScorecardValue; locked?: string }) {
  const router = useRouter();
  const [ratings, setRatings] = useState<Record<string, number | null>>(initial.ratings ?? {});
  const [rec, setRec] = useState(initial.recommendation ?? "");
  const [strengths, setStrengths] = useState(initial.strengths ?? "");
  const [concerns, setConcerns] = useState(initial.concerns ?? "");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  if (locked) return <p className="text-sm text-slate-600">{locked}</p>;
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setMsg("");
        if (!rec) return setMsg("Choose your overall recommendation.");
        setBusy(true);
        try {
          await api(`/api/panel/${interviewId}/scorecard`, { method: "PUT", body: { ratings, recommendation: rec, strengths, concerns } });
          router.refresh();
          setMsg(initial.submitted ? "Scorecard updated." : "Scorecard submitted.");
        } catch (err) {
          setMsg((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <table className="w-full text-sm">
        <caption className="sr-only">Rate each competency from 1 (weak) to 5 (exceptional)</caption>
        <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="py-1 pr-3">Competency</th>
            <th className="py-1">Rating (1 weak – 5 exceptional)</th>
          </tr>
        </thead>
        <tbody>
          {competencies.map((c) => (
            <tr key={c} className="border-t border-slate-100">
              <th scope="row" className="py-2 pr-3 text-left font-medium">
                {c}
              </th>
              <td className="py-2">
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={`${c} rating`}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <label key={n} className={`cursor-pointer rounded-md border px-2.5 py-1 ${ratings[c] === n ? "border-brand-600 bg-brand-50 font-semibold text-brand-700" : "border-slate-300"}`}>
                      <input type="radio" className="sr-only" name={c} checked={ratings[c] === n} onChange={() => setRatings({ ...ratings, [c]: n })} />
                      {n}
                    </label>
                  ))}
                  <label className={`cursor-pointer rounded-md border px-2.5 py-1 text-slate-600 ${c in ratings && ratings[c] == null ? "border-slate-600 bg-slate-100" : "border-slate-300"}`}>
                    <input type="radio" className="sr-only" name={c} checked={c in ratings && ratings[c] == null} onChange={() => setRatings({ ...ratings, [c]: null })} />
                    Not assessed
                  </label>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <label className="block max-w-xs text-sm">
        <span className="mb-1 block font-medium">Overall recommendation</span>
        <Select value={rec} onChange={(e) => setRec(e.target.value)}>
          <option value="">Choose…</option>
          {RECS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      </label>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Strengths (evidence)</span>
          <Textarea rows={4} maxLength={4000} value={strengths} onChange={(e) => setStrengths(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Concerns (evidence)</span>
          <Textarea rows={4} maxLength={4000} value={concerns} onChange={(e) => setConcerns(e.target.value)} />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy}>
          {initial.submitted ? "Update scorecard" : "Submit scorecard"}
        </Button>
        {msg && (
          <span role="status" className="text-sm text-slate-700">
            {msg}
          </span>
        )}
      </div>
    </form>
  );
}
