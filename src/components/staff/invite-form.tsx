"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Textarea } from "../ui";
import { api } from "../api";
import { CopyButton } from "./copy-button";

interface Result {
  name: string;
  email: string;
  link?: string;
  status: string;
}

export function InviteForm({ driveId }: { driveId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState("");
  return (
    <div className="space-y-3">
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
            const r = await api<{ results: Result[] }>(`/api/drives/${driveId}/invites`, { body: { candidates } });
            setResults(r.results);
            setText("");
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
