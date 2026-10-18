"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Textarea } from "../ui";
import { api } from "../api";
import { LocalTime } from "../local-time";

export interface CandidatePanel {
  id: string;
  title: string;
  durationMin: number;
  location: string;
  slots: string[];
  scheduledAt: string | null;
  status: "proposed" | "scheduled" | "reschedule_requested" | "completed" | "cancelled";
}

/** Candidate-side panel interview: pick a time, see the booking, or ask for other times. */
export function PanelCard({ token, iv }: { token: string; iv: CandidatePanel }) {
  const router = useRouter();
  const future = iv.slots.filter((s) => Date.parse(s) > Date.now());
  const [slot, setSlot] = useState(future[0] ?? "");
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const started = !!iv.scheduledAt && Date.parse(iv.scheduledAt) < Date.now();
  async function post(path: string, body: unknown) {
    setError("");
    setBusy(true);
    try {
      await api(`/api/c/${token}/panel/${iv.id}/${path}`, { body });
      setAsking(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby={`panel-${iv.id}`} className="rounded-xl border border-brand-200 bg-brand-50/40 p-4 text-sm">
      <h3 id={`panel-${iv.id}`} className="font-semibold">
        {iv.title} · {iv.durationMin} min
      </h3>
      {iv.status === "proposed" && (
        <fieldset className="mt-2">
          <legend className="text-slate-700">The hiring team would like to meet you. Choose a time (shown in your time zone):</legend>
          <div className="mt-2 space-y-1">
            {future.map((s) => (
              <label key={s} className="flex items-center gap-2">
                <input type="radio" name={`slot-${iv.id}`} checked={slot === s} onChange={() => setSlot(s)} />
                <LocalTime iso={s} />
              </label>
            ))}
            {!future.length && <p className="text-slate-600">All the offered times have passed — please ask for new ones.</p>}
          </div>
          {future.length > 0 && (
            <Button className="mt-3" disabled={busy || !slot} onClick={() => post("choose", { slot })}>
              Confirm this time
            </Button>
          )}
        </fieldset>
      )}
      {iv.status === "scheduled" && iv.scheduledAt && (
        <div className="mt-2 space-y-1">
          <p>
            <b>
              <LocalTime iso={iv.scheduledAt} />
            </b>
          </p>
          <p className="text-slate-700">{`Where: ${iv.location}`}</p>
          <a href={`/api/c/${token}/panel/${iv.id}/ics`} className="inline-block font-medium text-brand-700 underline" download>
            Add to calendar (.ics)
          </a>
        </div>
      )}
      {iv.status === "reschedule_requested" && <p className="mt-2 text-slate-700">You asked for different times. The hiring team will send new options by email.</p>}
      {iv.status !== "reschedule_requested" && !started && !asking && (
        <button className="mt-3 block text-sm text-slate-600 underline" onClick={() => setAsking(true)}>
          {iv.status === "scheduled" ? "Can't make it? Ask for another time" : "None of these times work for me"}
        </button>
      )}
      {asking && (
        <div className="mt-3 space-y-2">
          <label className="block">
            <span className="mb-1 block text-slate-700">When are you usually available? (optional)</span>
            <Textarea rows={2} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. weekdays after 4pm IST, or any time on Friday" />
          </label>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => post("other-times", { message })}>
              Ask for other times
            </Button>
            <Button variant="ghost" onClick={() => setAsking(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}
