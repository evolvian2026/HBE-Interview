"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Select, Textarea } from "../ui";
import { api } from "../api";

export interface AccommodationView {
  status: "pending" | "approved" | "declined";
  extraTimePct: number;
  extraBreaks: boolean;
  details: string | null;
  approvedExtraTimePct: number | null;
  approvedExtraBreaks: boolean | null;
  decisionNote: string | null;
}

const TIME_LABEL: Record<number, string> = { 0: "No extra time", 25: "25% extra time", 50: "50% extra time", 100: "Double time" };

function summary(pct: number, breaks: boolean) {
  const parts = [pct ? TIME_LABEL[pct] ?? `${pct}% extra time` : "", breaks ? "extra breaks (4 pauses of up to 10 minutes)" : ""].filter(Boolean);
  return parts.length ? parts.join(" and ") : "no timing changes";
}

/** Candidate-side: ask for interview adjustments and see the hiring team's answer. */
export function AccommodationCard({ token, companyName, current, canChange }: { token: string; companyName: string; current: AccommodationView | null; canChange: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pct, setPct] = useState(current?.extraTimePct ?? 0);
  const [breaks, setBreaks] = useState(current?.extraBreaks ?? false);
  const [details, setDetails] = useState(current?.details ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <section aria-labelledby="adjustments" className="mt-6 rounded-xl border border-slate-200 bg-white p-4 text-sm">
      <h2 id="adjustments" className="font-semibold">
        Adjustments for your interview
      </h2>
      <p className="mt-1 text-slate-600">
        If a disability, health condition or other circumstance means you&apos;d do better with more time or more breaks, you can ask {companyName} for adjustments. Only the recruiting team sees your request. It is never shared with the AI interviewer or used in your evaluation.
      </p>
      {current && !open && (
        <div role="status" className={current.status === "approved" ? "mt-3 rounded-lg bg-emerald-50 p-2 text-emerald-900" : current.status === "declined" ? "mt-3 rounded-lg bg-red-50 p-2 text-red-900" : "mt-3 rounded-lg bg-amber-50 p-2 text-amber-900"}>
          {current.status === "pending" && `You asked for ${summary(current.extraTimePct, current.extraBreaks)}. The hiring team will reply by email. If you start a round before then, the standard timing applies.`}
          {current.status === "approved" && `Approved: ${summary(current.approvedExtraTimePct ?? 0, !!current.approvedExtraBreaks)}. This applies to every round you haven't started yet.`}
          {current.status === "declined" && <>Your request wasn&apos;t approved.</>}
          {current.decisionNote && <p className="mt-1">{`Note from the hiring team: ${current.decisionNote}`}</p>}
        </div>
      )}
      {!canChange ? null : !open ? (
        <Button variant="ghost" className="mt-3" onClick={() => setOpen(true)}>
          {current ? "Change my request" : "Request adjustments…"}
        </Button>
      ) : (
        <div className="mt-3 space-y-3 rounded-lg border border-slate-200 p-3">
          <label className="block">
            <span className="mb-1 block font-medium text-slate-700">Extra time</span>
            <Select value={pct} onChange={(e) => setPct(Number(e.target.value))} className="max-w-60">
              {[0, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {TIME_LABEL[n]}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={breaks} onChange={(e) => setBreaks(e.target.checked)} />
            <span>Extra breaks: up to 4 pauses of up to 10 minutes each (normally 2 pauses of 2 minutes)</span>
          </label>
          <label className="block">
            <span className="mb-1 block font-medium text-slate-700">Anything else we should know? (optional)</span>
            <Textarea rows={3} maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="e.g. I use a screen reader; I'd prefer text mode and no voice questions." />
            <span className="mt-1 block text-xs text-slate-600">You don&apos;t have to share a diagnosis. Describe only what would help.</span>
          </label>
          {error && <p className="text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button
              disabled={busy}
              onClick={async () => {
                setError("");
                setBusy(true);
                try {
                  await api(`/api/c/${token}/accommodation`, { body: { extraTimePct: pct, extraBreaks: breaks, details } });
                  setOpen(false);
                  router.refresh();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Send request
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
