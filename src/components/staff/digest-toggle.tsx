"use client";

import { useState } from "react";
import { api } from "../api";

/** Opt in or out of the daily inbox email. */
export function DigestToggle({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <label className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-300">
      <input
        type="checkbox"
        checked={on}
        disabled={busy}
        onChange={async (e) => {
          const next = e.target.checked;
          setBusy(true);
          try {
            await api("/api/auth/digest", { method: "PUT", body: { optIn: next } });
            setOn(next);
          } finally {
            setBusy(false);
          }
        }}
      />
      Email me a daily summary
    </label>
  );
}
