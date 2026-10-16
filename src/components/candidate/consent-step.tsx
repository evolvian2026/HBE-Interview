"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "../ui";
import { api } from "../api";

export function ConsentStep({ token, text, companyName, webcamRequired = false }: { token: string; text: string; companyName: string; webcamRequired?: boolean }) {
  const router = useRouter();
  const [agree, setAgree] = useState(false);
  const [rules, setRules] = useState(false);
  const [webcam, setWebcam] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function send(accept: boolean) {
    setBusy(true);
    setError("");
    try {
      await api(`/api/c/${token}/consent`, { body: { accept, webcam: webcamRequired && webcam } });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Before you begin</h2>
      <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed whitespace-pre-line text-slate-700">{text}</div>
      <div className="rounded-lg border border-slate-200 p-4 text-sm text-slate-700">
        <p className="font-medium">Interview rules</p>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>Answer in your own words. Please don&apos;t use other people or AI tools to answer for you.</li>
          <li>Browser activity such as switching tabs and pasting text is recorded and shared with the hiring team as context.</li>
          <li>You can ask the interviewer to repeat or clarify, skip up to 3 questions, and pause twice per round.</li>
        </ul>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>I consent to {companyName} recording and evaluating my interview with AI as described above.</span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={rules} onChange={(e) => setRules(e.target.checked)} />
        <span>I agree to the interview rules.</span>
      </label>
      {webcamRequired && (
        <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
          <input type="checkbox" className="mt-1" checked={webcam} onChange={(e) => setWebcam(e.target.checked)} />
          <span>
            This interview uses <b>webcam proctoring</b>: a small, low-resolution photo is taken periodically during each round and checked only for whether one person is present. No face recognition is performed. Photos are visible to the hiring team as context (never scored) and are deleted with your data. I consent to webcam snapshots.
          </span>
        </label>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={!agree || !rules || (webcamRequired && !webcam) || busy} onClick={() => send(true)}>
          Accept and continue
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => confirm("Declining means you can't take this interview. Continue?") && send(false)}>
          Decline
        </Button>
      </div>
    </div>
  );
}
