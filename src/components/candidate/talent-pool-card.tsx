"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Select } from "../ui";
import { api } from "../api";

/** Candidate opt-in to be considered for future roles (and to leave again). */
export function TalentPoolCard({ token, companyName, expiresAt }: { token: string; companyName: string; expiresAt: string | null }) {
  const router = useRouter();
  const [months, setMonths] = useState(12);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(m: number | null) {
    setError("");
    setBusy(true);
    try {
      await api(`/api/c/${token}/talent-pool`, { body: { months: m } });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby="talent-pool" className="mt-6 rounded-xl border border-slate-200 bg-white p-4 text-sm">
      <h2 id="talent-pool" className="font-semibold">
        Future roles at {companyName}
      </h2>
      {expiresAt ? (
        <>
          <p role="status" className="mt-1 text-slate-700">
            {`You're in ${companyName}'s talent pool until ${new Date(expiresAt).toLocaleDateString()}. The recruiting team may invite you to other roles, and your profile and interview record are kept until then.`}
          </p>
          <Button variant="ghost" className="mt-2" disabled={busy} onClick={() => save(null)}>
            Leave the talent pool
          </Button>
        </>
      ) : (
        <>
          <p className="mt-1 text-slate-600">
            {`Want ${companyName} to keep you in mind for other roles? If you agree, your profile and interview record are kept for the period you choose (instead of being deleted after this process), and the recruiting team may invite you to apply. You can leave at any time.`}
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-700">Keep me on file for</span>
              <Select value={months} onChange={(e) => setMonths(Number(e.target.value))}>
                <option value={6}>6 months</option>
                <option value={12}>12 months</option>
                <option value={24}>24 months</option>
              </Select>
            </label>
            <Button variant="secondary" disabled={busy} onClick={() => save(months)}>
              Keep me in mind
            </Button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="mt-2 text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}
