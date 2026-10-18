"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge, Button } from "../ui";
import { api } from "../api";

export interface SuggestionView {
  candidateId: string;
  name: string;
  score: number;
  matchedMust: string[];
  missingMust: string[];
  matchedNice: string[];
  yearsOk: boolean | null;
  lastDrive: string;
  lastAi: string | null;
  tags: string[];
}

/** Talent-pool people who fit this drive's role, with why, and a bulk invite. */
export function PoolSuggestions({ driveId, items }: { driveId: string; items: SuggestionView[] }) {
  const router = useRouter();
  const [chosen, setChosen] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-3 text-sm">
      <ul className="divide-y divide-slate-100">
        {items.map((s) => (
          <li key={s.candidateId} className="flex items-start gap-3 py-2">
            <input type="checkbox" className="mt-1" aria-label={`Select ${s.name}`} checked={chosen.includes(s.candidateId)} onChange={(e) => setChosen(e.target.checked ? [...chosen, s.candidateId] : chosen.filter((x) => x !== s.candidateId))} />
            <div className="min-w-0 flex-1">
              <p>
                <Link href={`/app/talent/${s.candidateId}`} className="font-medium text-brand-700 hover:underline">
                  {s.name}
                </Link>{" "}
                <Badge tone={s.score >= 75 ? "green" : s.score >= 60 ? "blue" : "slate"}>{`${s.score}% fit`}</Badge> {s.tags.length > 0 && <span className="text-xs text-slate-500">{s.tags.join(", ")}</span>}
              </p>
              <p className="text-xs text-slate-600">
                {s.matchedMust.length > 0 && `Has: ${s.matchedMust.join(", ")}. `}
                {s.missingMust.length > 0 && `Missing: ${s.missingMust.join(", ")}. `}
                {s.matchedNice.length > 0 && `Bonus: ${s.matchedNice.join(", ")}. `}
                {s.yearsOk === false && "Less experience than the level asks for. "}
                {s.lastDrive && `Last applied for ${s.lastDrive}${s.lastAi ? ` (AI: ${s.lastAi.replace("_", " ")})` : ""}.`}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={busy || !chosen.length}
          onClick={async () => {
            setMsg("");
            setBusy(true);
            try {
              const r = await api<{ results: { status: string; message?: string }[] }>(`/api/drives/${driveId}/pool-invites`, { body: { candidateIds: chosen } });
              const ok = r.results.filter((x) => x.status === "invited").length;
              const failed = r.results.filter((x) => x.status !== "invited");
              setMsg(`${ok} invited${failed.length ? `; ${failed.length} not invited (${failed.map((f) => f.message).join("; ")})` : ""}. Their resumes are being matched to this role.`);
              setChosen([]);
              router.refresh();
            } catch (e) {
              setMsg((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {chosen.length ? `Invite ${chosen.length} selected` : "Select people to invite"}
        </Button>
        {msg && (
          <span role="status" className="text-slate-700">
            {msg}
          </span>
        )}
      </div>
      <p className="text-xs text-slate-500">Fit = must-have skills (70%), nice-to-haves (20%) and years of experience for the level (10%), from each person&apos;s latest resume. Only people who agreed to be contacted about other roles are listed.</p>
    </div>
  );
}
