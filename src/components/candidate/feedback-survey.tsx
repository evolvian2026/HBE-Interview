"use client";

import { useState } from "react";
import { Button, Textarea, cx } from "../ui";
import { api } from "../api";

const QUESTIONS = [
  { key: "overall", label: "Overall, how was this round?", required: true },
  { key: "fairness", label: "Did the questions feel fair and relevant to the role?" },
  { key: "clarity", label: "Were the questions and instructions clear?" },
  { key: "technical", label: "Did the interview tools (chat, voice, editor) work well?" },
] as const;
type Key = (typeof QUESTIONS)[number]["key"];

function Stars({ value, onChange, label }: { value: number | null; onChange: (v: number) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} of 5`}
          onClick={() => onChange(n)}
          className={cx("h-8 w-8 rounded-md border text-sm font-medium", value != null && n <= value ? "border-brand-500 bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-500 hover:border-brand-300")}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

/** Optional post-round experience survey. Ratings are anonymous to the evaluator and never affect scores. */
export function FeedbackSurvey({ token, roundIndex, roundLabel }: { token: string; roundIndex: number; roundLabel?: string }) {
  const [v, setV] = useState<Record<Key, number | null>>({ overall: null, fairness: null, clarity: null, technical: null });
  const [comment, setComment] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done" | "skipped">("idle");
  const [error, setError] = useState("");
  if (state === "done") return <p className="text-sm text-emerald-700">Thanks for your feedback — it helps us make the interview better for everyone.</p>;
  if (state === "skipped") return null;
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div>
        <p className="font-medium">How did {roundLabel ? `the ${roundLabel}` : "this round"} go for you?</p>
        <p className="text-xs text-slate-500">Optional · 30 seconds · Your ratings don&apos;t affect your evaluation.</p>
      </div>
      {QUESTIONS.map((q) => (
        <div key={q.key} className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-slate-700">{q.label}</span>
          <Stars label={q.label} value={v[q.key]} onChange={(n) => setV({ ...v, [q.key]: n })} />
        </div>
      ))}
      <Textarea rows={2} maxLength={2000} placeholder="Anything we could improve? (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button
          disabled={v.overall == null || state === "busy"}
          onClick={async () => {
            setState("busy");
            setError("");
            try {
              await api(`/api/c/${token}/feedback`, { body: { roundIndex, ...v, comment } });
              setState("done");
            } catch (e) {
              setError((e as Error).message);
              setState("idle");
            }
          }}
        >
          Send feedback
        </Button>
        <Button variant="ghost" onClick={() => setState("skipped")}>
          Skip
        </Button>
      </div>
    </div>
  );
}
