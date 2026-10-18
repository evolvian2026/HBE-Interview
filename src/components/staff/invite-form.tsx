"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Textarea } from "../ui";
import { api } from "../api";
import { CopyButton } from "./copy-button";
import { csvToInvitees } from "@/lib/csv";

interface Result {
  name: string;
  email: string;
  link?: string;
  status: string;
}

export function InviteForm({ driveId }: { driveId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [fromCsv, setFromCsv] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState("");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <label className="cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-50">
          Upload CSV
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setFromCsv(true);
              setText(csvToInvitees(await f.text()).map((p) => `${p.name}, ${p.email}`).join("\n"));
              e.target.value = "";
            }}
          />
        </label>
        <span>Columns: name, email (header row optional; up to 200 rows)</span>
      </div>
      <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={"One per line: Name, email\nPriya Sharma, priya@example.com"} />
      <Button
        disabled={busy || !text.trim()}
        onClick={async () => {
          setBusy(true);
          setError("");
          const candidates = text
            .split("\n")
            .map((l) => l.split(/[,\t;]/).map((x) => x.trim()))
            .filter((p) => p.length >= 2)
            .map(([name, email]) => ({ name, email }));
          try {
            const r = await api<{ results: Result[] }>(`/api/drives/${driveId}/invites`, { body: { candidates, source: fromCsv ? "csv" : "invite" } });
            setResults(r.results);
            setText("");
            setFromCsv(false);
            router.refresh();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Inviting…" : "Create invites"}
      </Button>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {results.length > 0 && (
        <ul className="space-y-2 text-sm">
          {results.map((r) => (
            <li key={r.email} className="flex flex-wrap items-center gap-2">
              <Badge tone={r.status === "invalid" ? "red" : r.status === "invited" ? "green" : "slate"}>{r.status.replace("_", " ")}</Badge>
              <span>
                {r.name} &lt;{r.email}&gt;
              </span>
              {r.link && <CopyButton text={r.link} label="Copy personal link" />}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-slate-500">Invites are emailed automatically when email is configured; personal links can always be copied here.</p>
    </div>
  );
}

