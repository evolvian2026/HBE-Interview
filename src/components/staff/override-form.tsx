"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Select, Textarea } from "../ui";
import { api } from "../api";

export function OverrideForm({ reportId, parameter, current }: { reportId: string; parameter: string; current: number | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [score, setScore] = useState(current ?? 3);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  if (!open)
    return (
      <button className="mt-1 block text-xs text-brand-600 hover:underline" onClick={() => setOpen(true)}>
        Override
      </button>
    );
  return (
    <div className="mt-2 w-56 space-y-2 rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
      <Select aria-label="New score (1–5)" value={score} onChange={(e) => setScore(Number(e.target.value))}>
        {[1, 2, 3, 4, 5].map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </Select>
      <Textarea rows={3} aria-label="Reason for the override" placeholder="Reason (min 20 characters)" value={reason} onChange={(e) => setReason(e.target.value)} />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-1">
        <Button
          className="px-2 py-1 text-xs"
          onClick={async () => {
            try {
              await api(`/api/reports/${reportId}/override`, { body: { parameter, score, reason } });
              setOpen(false);
              router.refresh();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Save
        </Button>
        <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
