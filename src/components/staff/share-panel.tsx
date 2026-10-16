"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Input, Select } from "../ui";
import { api } from "../api";
import { CopyButton } from "./copy-button";

interface Link {
  id: string;
  masked: boolean;
  hasPasscode: boolean;
  expiresAt: string;
  revoked: boolean;
  views: number;
}

export function SharePanel({ candidacyId, links, canShare }: { candidacyId: string; links: Link[]; canShare: boolean }) {
  const router = useRouter();
  const [days, setDays] = useState(7);
  const [masked, setMasked] = useState(true);
  const [passcode, setPasscode] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState("");
  return (
    <Card title="Export & share">
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap gap-2">
          <a className="rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50" href={`/print/candidates/${candidacyId}`} target="_blank" rel="noreferrer">
            PDF / print
          </a>
          <a className="rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50" href={`/print/candidates/${candidacyId}?masked=1`} target="_blank" rel="noreferrer">
            PDF (identity masked)
          </a>
          <a className="rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50" href={`/print/candidates/${candidacyId}?transcript=1`} target="_blank" rel="noreferrer">
            PDF with transcripts
          </a>
        </div>
        {canShare && (
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="mb-2 font-medium">Share a read-only link</p>
            <div className="flex flex-wrap items-center gap-2">
              <Select className="w-36" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                {[1, 3, 7, 14, 30].map((d) => (
                  <option key={d} value={d}>
                    Expires in {d}d
                  </option>
                ))}
              </Select>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={masked} onChange={(e) => setMasked(e.target.checked)} /> Mask identity
              </label>
              <Input className="w-48" type="password" placeholder="Optional passcode (4+)" value={passcode} onChange={(e) => setPasscode(e.target.value)} />
              <Button
                variant="secondary"
                onClick={async () => {
                  setError("");
                  try {
                    const r = await api<{ url: string }>(`/api/candidacies/${candidacyId}/share`, { body: { days, masked, ...(passcode ? { passcode } : {}) } });
                    setCreated(r.url);
                    setPasscode("");
                    router.refresh();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Create link
              </Button>
            </div>
            {created && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="break-all rounded bg-white px-2 py-1 text-xs">{created}</code>
                <CopyButton text={created} />
              </div>
            )}
            {error && <p className="mt-1 text-red-600">{error}</p>}
          </div>
        )}
        {links.length > 0 && (
          <ul className="space-y-1">
            {links.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-2 text-xs">
                <Badge tone={l.revoked || new Date(l.expiresAt) < new Date() ? "slate" : "green"}>{l.revoked ? "revoked" : new Date(l.expiresAt) < new Date() ? "expired" : "active"}</Badge>
                <span>
                  {l.masked ? "masked" : "named"}
                  {l.hasPasscode ? " · passcode" : ""} · expires {new Date(l.expiresAt).toLocaleDateString()} · {l.views} view(s)
                </span>
                {!l.revoked && canShare && (
                  <button
                    className="text-red-600 hover:underline"
                    onClick={async () => {
                      await api(`/api/share/${l.id}`, { method: "DELETE" });
                      router.refresh();
                    }}
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
