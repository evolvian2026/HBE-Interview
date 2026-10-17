"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "../api";

/** Add a round to the blind-review queue. */
export function RequestCalibrationButton({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="text-xs text-brand-600 hover:underline disabled:opacity-50"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api(`/api/reports/${reportId}/calibration`, { body: {} });
          router.refresh();
        } catch (e) {
          alert((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      Ask for a blind review
    </button>
  );
}
