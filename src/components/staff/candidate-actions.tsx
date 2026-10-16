"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "../ui";
import { api } from "../api";

export function CandidateActions(p: {
  candidacyId: string;
  stage: string;
  currentRoundIndex: number;
  isLastRound: boolean;
  canDecide: boolean;
  canRecruit: boolean;
  isAdmin: boolean;
  hasResume: boolean;
  hasReports: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    try {
      await fn();
      after ? after() : router.refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const gate = (decision: "advance" | "hold" | "reject") => {
    const reason = prompt(decision === "advance" ? "Optional note for advancing:" : `Reason to ${decision}:`) ?? undefined;
    if (decision !== "advance" && !reason) return;
    run(() => api(`/api/candidacies/${p.candidacyId}/gate`, { body: { decision, reason } }));
  };
  const status = (s: string) => run(() => api(`/api/candidacies/${p.candidacyId}/status`, { body: { status: s } }));
  return (
    <div className="flex flex-wrap gap-2">
      {p.canDecide && ["gate_pending", "on_hold"].includes(p.stage) && !p.isLastRound && (
        <>
          <Button disabled={busy} onClick={() => gate("advance")}>Advance to next round</Button>
          {p.stage !== "on_hold" && <Button variant="secondary" disabled={busy} onClick={() => gate("hold")}>Hold</Button>}
          <Button variant="danger" disabled={busy} onClick={() => gate("reject")}>Reject</Button>
        </>
      )}
      {p.canDecide && ["completed", "on_hold", "gate_pending"].includes(p.stage) && (
        <>
          <Button variant="secondary" disabled={busy} onClick={() => status("shortlisted")}>Shortlist</Button>
          {p.stage === "completed" && <Button variant="secondary" disabled={busy} onClick={() => status("rejected")}>Reject</Button>}
        </>
      )}
      {p.canDecide && p.hasReports && (
        <Button variant="ghost" disabled={busy} onClick={() => run(() => api(`/api/candidacies/${p.candidacyId}/combined`, { body: {} }), () => setTimeout(() => router.refresh(), 2500))}>
          Generate combined report
        </Button>
      )}
      {p.hasResume && (
        <a className="rounded-lg px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-100" href={`/api/candidacies/${p.candidacyId}/resume`}>
          Download resume
        </a>
      )}
      {p.canRecruit && ["in_round", "evaluating", "gate_pending", "expired", "round_available"].includes(p.stage) && (
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => {
            const reason = prompt("Grant a retake of the current round (e.g. after a technical failure). Reason:");
            if (reason) run(() => api(`/api/candidacies/${p.candidacyId}/retake`, { body: { roundIndex: p.currentRoundIndex, reason } }));
          }}
        >
          Grant retake
        </Button>
      )}
      {p.isAdmin && (
        <Button
          variant="ghost"
          className="text-red-600"
          disabled={busy}
          onClick={() =>
            confirm("Permanently delete this candidate's data for this drive (resume, transcripts, code, reports)? This cannot be undone.") &&
            run(() => api(`/api/candidacies/${p.candidacyId}`, { method: "DELETE" }), () => router.push("/app"))
          }
        >
          Delete data
        </Button>
      )}
    </div>
  );
}
