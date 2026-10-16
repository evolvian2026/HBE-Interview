"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "../ui";
import { api } from "../api";

export function ResumeStep({ token, initialStatus, initialError }: { token: string; initialStatus: string; initialError?: string | null }) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [error, setError] = useState(initialError ?? "");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!["uploaded", "parsing"].includes(status)) return;
    const t = setInterval(async () => {
      const r = await api<{ status: string; error?: string }>(`/api/c/${token}/resume`).catch(() => null);
      if (!r) return;
      setStatus(r.status);
      if (r.status === "failed") setError(r.error ?? "We couldn't read your resume");
      if (r.status === "parsed") router.refresh();
    }, 2000);
    return () => clearInterval(t);
  }, [status, token, router]);

  async function upload(file: File) {
    setBusy(true);
    setError("");
    const form = new FormData();
    form.append("file", file);
    try {
      await api(`/api/c/${token}/resume`, { form });
      setStatus("uploaded");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const working = status === "uploaded" || status === "parsing";
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Upload your resume</h2>
      <p className="text-sm text-slate-600">PDF, DOCX, or a clear photo/scan (PNG, JPEG), up to 5 MB. The AI reads your skills, experience and projects to tailor your interview. You&apos;ll be able to review what it extracted.</p>
      {working ? (
        <div className="flex items-center gap-3 rounded-lg bg-brand-50 p-4 text-sm text-brand-700">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
          Reading your resume and understanding your experience…
        </div>
      ) : (
        <div
          className="rounded-xl border-2 border-dashed border-slate-300 p-8 text-center"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) upload(f);
          }}
        >
          <p className="text-sm text-slate-600">Drag and drop your resume here, or</p>
          <input ref={fileRef} type="file" accept=".pdf,.docx,.png,.jpg,.jpeg" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <Button className="mt-3" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? "Uploading…" : "Choose file"}
          </Button>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
