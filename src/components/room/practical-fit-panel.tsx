"use client";

import { useState } from "react";
import { Button, Field, Input, Select } from "../ui";
import type { PracticalFitWorkspace } from "@/lib/interview/exercises";
import type { PracticalFitData } from "@/lib/core/practical-fit";

export function PracticalFitPanel({ ws, base, disabled, onConfirmed }: { ws: PracticalFitWorkspace; base: string; disabled: boolean; onConfirmed: () => void }) {
  const [d, setD] = useState<PracticalFitData>(ws.data);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof PracticalFitData>(k: K, v: PracticalFitData[K]) => setD((x) => ({ ...x, [k]: v }));
  const locked = disabled || ws.submitted;
  return (
    <div className="h-full space-y-4 overflow-y-auto p-4">
      <div>
        <p className="font-semibold">Practical details</p>
        <p className="text-sm text-slate-600">These help the team plan next steps. They&apos;re not part of your interview score.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Current location (city)">
          <Input disabled={locked} value={d.currentLocation} onChange={(e) => set("currentLocation", e.target.value)} />
        </Field>
        <Field label="Willing to relocate?">
          <Select disabled={locked} value={d.willingToRelocate} onChange={(e) => set("willingToRelocate", e.target.value as PracticalFitData["willingToRelocate"])}>
            <option value="">Select</option>
            <option value="yes">Yes</option>
            <option value="depends">Depends</option>
            <option value="no">No</option>
          </Select>
        </Field>
        <Field label="Preferred work model">
          <Select disabled={locked} value={d.workModel} onChange={(e) => set("workModel", e.target.value as PracticalFitData["workModel"])}>
            <option value="">Select</option>
            <option value="onsite">On-site</option>
            <option value="hybrid">Hybrid</option>
            <option value="remote">Remote</option>
            <option value="flexible">Flexible</option>
          </Select>
        </Field>
        <Field label="Notice period (days)">
          <Input disabled={locked} type="number" min={0} max={365} value={d.noticeDays ?? ""} onChange={(e) => set("noticeDays", e.target.value === "" ? null : Number(e.target.value))} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" disabled={locked} checked={d.noticeNegotiable} onChange={(e) => set("noticeNegotiable", e.target.checked)} /> Notice period is negotiable
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" disabled={locked} checked={d.servingNotice} onChange={(e) => set("servingNotice", e.target.checked)} /> Currently serving notice
        </label>
        <Field label="Earliest joining date">
          <Input disabled={locked} type="date" value={d.earliestJoiningDate} onChange={(e) => set("earliestJoiningDate", e.target.value)} />
        </Field>
        <Field label="Other offers in hand? (optional)">
          <Select disabled={locked} value={d.otherOffers} onChange={(e) => set("otherOffers", e.target.value as PracticalFitData["otherOffers"])}>
            <option value="">Prefer not to say</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </Select>
        </Field>
        {ws.askCompensation && (
          <>
            <Field label={`Expected compensation — min (${ws.currency}/year)`}>
              <Input disabled={locked || d.compPreferLater} type="number" min={0} value={d.expectedCompMin ?? ""} onChange={(e) => set("expectedCompMin", e.target.value === "" ? null : Number(e.target.value))} />
            </Field>
            <Field label={`Expected compensation — max (${ws.currency}/year)`}>
              <Input disabled={locked || d.compPreferLater} type="number" min={0} value={d.expectedCompMax ?? ""} onChange={(e) => set("expectedCompMax", e.target.value === "" ? null : Number(e.target.value))} />
            </Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" disabled={locked} checked={d.compPreferLater} onChange={(e) => set("compPreferLater", e.target.checked)} /> I&apos;d prefer to discuss compensation later
            </label>
          </>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button
        disabled={locked || busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          const res = await fetch(`${base}/practical-fit`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: d }) });
          setBusy(false);
          if (!res.ok) setError((await res.json())?.error?.message ?? "Could not save");
          else onConfirmed();
        }}
      >
        {ws.submitted ? "Confirmed" : "Confirm details"}
      </Button>
    </div>
  );
}
