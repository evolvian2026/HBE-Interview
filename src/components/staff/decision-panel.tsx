"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Textarea } from "../ui";
import { api } from "../api";

/** The final hiring decision: offer, reject or hold, with reasoning and an optional message to the candidate. */
export function DecisionPanel({ candidacyId, pendingScorecards }: { candidacyId: string; pendingScorecards: number }) {
  const router = useRouter();
  const [decision, setDecision] = useState<"offer" | "reject" | "hold" | "">("");
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-3 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        if (!decision) return setError("Choose a decision.");
        if (pendingScorecards && !confirm(`${pendingScorecards} panel scorecard(s) are still missing. Decide anyway?`)) return;
        setBusy(true);
        try {
          await api(`/api/candidacies/${candidacyId}/decision`, { body: { decision, reason, notifyCandidate: notify && decision !== "hold" } });
          setDecision("");
          setReason("");
          router.refresh();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset>
        <legend className="mb-1 font-medium">Decision</legend>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["offer", "Make an offer"],
              ["reject", "Reject"],
              ["hold", "Hold"],
            ] as const
          ).map(([v, l]) => (
            <label key={v} className={`cursor-pointer rounded-lg border px-3 py-1.5 ${decision === v ? (v === "reject" ? "border-red-600 bg-red-50 text-red-800" : "border-brand-600 bg-brand-50 text-brand-800") : "border-slate-300"}`}>
              <input type="radio" className="sr-only" name="decision" checked={decision === v} onChange={() => setDecision(v)} />
              {l}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block">
        <span className="mb-1 block font-medium">Reasoning (recorded with the decision)</span>
        <Textarea rows={3} maxLength={4000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What the decision rests on: panel evidence, AI report, practical fit…" />
      </label>
      {decision !== "hold" && (
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          <span>Tell the candidate now (email and their interview page). Untick to tell them yourself, e.g. by phone.</span>
        </label>
      )}
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      <Button type="submit" variant={decision === "reject" ? "danger" : "primary"} disabled={busy}>
        Record decision
      </Button>
    </form>
  );
}
