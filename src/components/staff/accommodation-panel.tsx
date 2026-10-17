"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Select, Textarea } from "../ui";
import { api } from "../api";

export interface StaffAccommodation {
  status: "pending" | "approved" | "declined";
  extraTimePct: number;
  extraBreaks: boolean;
  details: string | null;
  approvedExtraTimePct: number | null;
  approvedExtraBreaks: boolean | null;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

const pctLabel = (n: number) => (n === 100 ? "double time" : n ? `+${n}% time` : "no extra time");

/** Recruiters/admins: the candidate's adjustment request, with approve (optionally adjusted) or decline. */
export function AccommodationPanel({ candidacyId, a }: { candidacyId: string; a: StaffAccommodation }) {
  const router = useRouter();
  const [pct, setPct] = useState(a.approvedExtraTimePct ?? a.extraTimePct);
  const [breaks, setBreaks] = useState(a.approvedExtraBreaks ?? a.extraBreaks);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function decide(approve: boolean) {
    setError("");
    setBusy(true);
    try {
      await api(`/api/candidacies/${candidacyId}/accommodation`, { body: { approve, extraTimePct: pct, extraBreaks: breaks, note } });
      setNote("");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          Interview adjustments <Badge tone={a.status === "approved" ? "green" : a.status === "declined" ? "red" : "amber"}>{a.status}</Badge>
        </span>
      }
    >
      <div className="space-y-3 text-sm">
        <p>
          Requested {new Date(a.createdAt).toLocaleDateString()}: <b>{pctLabel(a.extraTimePct)}</b>
          {a.extraBreaks && <b>, extra breaks</b>}.
        </p>
        {a.details && <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-2">{a.details}</p>}
        <p className="text-xs text-slate-600">Visible to recruiters and admins only; never shown to hiring managers, the AI interviewer or the evaluator. Approved adjustments apply to rounds the candidate hasn&apos;t started.</p>
        {a.status !== "pending" && (
          <p>
            {a.status === "approved" ? `Approved: ${pctLabel(a.approvedExtraTimePct ?? 0)}${a.approvedExtraBreaks ? ", extra breaks" : ""}` : "Declined"}
            {a.decidedBy ? ` by ${a.decidedBy}` : ""}
            {a.decidedAt ? ` on ${new Date(a.decidedAt).toLocaleDateString()}` : ""}.{a.decisionNote ? ` Note: ${a.decisionNote}` : ""}
          </p>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">Extra time to grant</span>
            <Select value={pct} onChange={(e) => setPct(Number(e.target.value))}>
              {[0, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {pctLabel(n)}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex items-center gap-2 pb-2">
            <input type="checkbox" checked={breaks} onChange={(e) => setBreaks(e.target.checked)} /> Extra breaks
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-700">Note to the candidate (required to decline)</span>
          <Textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {error && <p className="text-red-600">{error}</p>}
        <div className="flex gap-2">
          <Button disabled={busy} onClick={() => decide(true)}>
            {a.status === "approved" ? "Update approval" : "Approve"}
          </Button>
          {a.status !== "declined" && (
            <Button variant="ghost" disabled={busy} onClick={() => decide(false)}>
              Decline…
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
