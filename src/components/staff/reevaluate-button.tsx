"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "../api";

export function ReevaluateButton({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="text-xs text-brand-600 hover:underline disabled:opacity-50"
      disabled={busy}
      onClick={async () => {
        if (!confirm("Re-run the AI evaluation for this round? Recruiter overrides on this round will be replaced by the new scores.")) return;
        setBusy(true);
        try {
          await api(`/api/reports/${reportId}/reevaluate`, { body: {} });
          setTimeout(() => router.refresh(), 2000);
        } catch (e) {
          alert((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Queued…" : "Re-evaluate"}
    </button>
  );
}
