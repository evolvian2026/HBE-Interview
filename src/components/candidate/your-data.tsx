"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Textarea } from "../ui";
import { api } from "../api";

/** Candidate data rights: download everything we hold about you, or ask for it to be deleted. */
export function YourData({ token, companyName, pendingDueAt }: { token: string; companyName: string; pendingDueAt: string | null }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  return (
    <section aria-labelledby="your-data" className="mt-6 rounded-xl border border-slate-200 bg-white p-4 text-sm">
      <h2 id="your-data" className="font-semibold">
        Your data
      </h2>
      <p className="mt-1 text-slate-600">
        Download a copy of the information you shared and your interview record, or ask {companyName} to delete it.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={`/api/c/${token}/data`} className="rounded-lg bg-white px-3.5 py-2 font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50" download>
          Download my data
        </a>
        {!pendingDueAt && !asking && (
          <Button variant="ghost" onClick={() => setAsking(true)}>
            Delete my data…
          </Button>
        )}
      </div>
      {pendingDueAt && (
        <p role="status" className="mt-3 rounded-lg bg-amber-50 p-2 text-amber-900">
          You asked for your data to be deleted. It will be deleted by {new Date(pendingDueAt).toLocaleDateString()} (sooner if the hiring team actions it), and you&apos;ll get an email when it&apos;s done. Deleting your data also withdraws your application.
        </p>
      )}
      {asking && (
        <div className="mt-3 space-y-2 rounded-lg border border-red-200 bg-red-50/50 p-3">
          <p className="font-medium text-red-900">This withdraws your application and permanently deletes your resume, interview record and assessments. It can&apos;t be undone.</p>
          <label className="block">
            <span className="text-slate-700">Reason (optional)</span>
            <Textarea rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          {error && <p className="text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button
              variant="danger"
              onClick={async () => {
                setError("");
                try {
                  await api(`/api/c/${token}/deletion`, { body: { reason } });
                  setAsking(false);
                  router.refresh();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Request deletion
            </Button>
            <Button variant="ghost" onClick={() => setAsking(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
