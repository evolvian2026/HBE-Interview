"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Select, Textarea } from "../ui";
import { api } from "../api";

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function run(fn: () => Promise<string | void>) {
    setBusy(true);
    setMsg("");
    try {
      const m = await fn();
      if (m) setMsg(m);
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { busy, msg, run };
}

const Status = ({ msg }: { msg: string }) =>
  msg ? (
    <span role="status" className="text-sm text-slate-700">
      {msg}
    </span>
  ) : null;

/** Record what a person concluded about a match. */
export function MatchReview({ matchId, status, note }: { matchId: string; status: string; note: string }) {
  const { busy, msg, run } = useAction();
  const [n, setN] = useState(note);
  const save = (s: string, done: string) => run(async () => (await api(`/api/code-similarity/matches/${matchId}`, { body: { status: s, note: n } }), done));
  return (
    <div className="space-y-3 text-sm">
      <Field label="Note" hint="What you compared and concluded. Required when marking as copied.">
        <Textarea rows={3} value={n} maxLength={2000} onChange={(e) => setN(e.target.value)} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => save("coincidence", "Marked as a coincidence.")}>
          Coincidence / common approach
        </Button>
        <Button variant="danger" disabled={busy} onClick={() => save("copied", "Marked as likely copied.")}>
          Likely copied
        </Button>
        {status !== "open" && (
          <Button variant="ghost" disabled={busy} onClick={() => save("open", "Reopened.")}>
            Reopen
          </Button>
        )}
        <Status msg={msg} />
      </div>
    </div>
  );
}

export function AddReferenceForm({ problems }: { problems: { id: string; title: string }[] }) {
  const { busy, msg, run } = useAction();
  const [problemId, setProblemId] = useState(problems[0]?.id ?? "");
  const [language, setLanguage] = useState("python");
  const [source, setSource] = useState("");
  const [code, setCode] = useState("");
  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Problem">
          <Select value={problemId} onChange={(e) => setProblemId(e.target.value)}>
            {problems.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Language">
          <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="python">Python</option>
            <option value="javascript">JavaScript</option>
            <option value="java">Java</option>
            <option value="cpp">C++</option>
          </Select>
        </Field>
        <Field label="Where it was found">
          <Input value={source} maxLength={300} placeholder="e.g. URL of a forum post" onChange={(e) => setSource(e.target.value)} />
        </Field>
      </div>
      <Field label="Solution code">
        <Textarea rows={8} className="font-mono text-xs" value={code} onChange={(e) => setCode(e.target.value)} />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={busy || !source.trim() || code.trim().length < 20}
          onClick={() =>
            run(async () => {
              const r = await api<{ matches: number; checked: number }>("/api/code-similarity/references", { body: { problemId, language, source, code } });
              setCode("");
              setSource("");
              return `Saved. Checked ${r.checked} past submission${r.checked === 1 ? "" : "s"}: ${r.matches} match${r.matches === 1 ? "" : "es"}.`;
            })
          }
        >
          Add known solution
        </Button>
        <Status msg={msg} />
      </div>
    </div>
  );
}

export function RetireButton({ problemId, retired }: { problemId: string; retired: boolean }) {
  const { busy, msg, run } = useAction();
  return (
    <span className="flex items-center gap-2">
      <Button
        variant={retired ? "secondary" : "ghost"}
        disabled={busy}
        onClick={() => (retired || confirm("Stop using this problem for new interviews? Interviews already in progress keep it.")) && run(async () => (await api(`/api/code-similarity/problems/${encodeURIComponent(problemId)}`, { body: { retired: !retired } }), retired ? "Back in use." : "Retired."))}
      >
        {retired ? "Use again" : "Retire"}
      </Button>
      <Status msg={msg} />
    </span>
  );
}

export function RemoveReference({ id }: { id: string }) {
  const { busy, run } = useAction();
  return (
    <button className="text-xs text-red-700 hover:underline disabled:opacity-50" disabled={busy} onClick={() => confirm("Remove this known solution? Matches against it are removed too.") && run(async () => void (await api(`/api/code-similarity/references/${id}`, { method: "DELETE" })))}>
      remove
    </button>
  );
}

export function ScanPast() {
  const { busy, msg, run } = useAction();
  return (
    <span className="flex items-center gap-2">
      <Button variant="secondary" disabled={busy} onClick={() => run(async () => `${(await api<{ queued: number }>("/api/code-similarity/scan", { body: {} })).queued} past round(s) queued for checking.`)}>
        Check past rounds
      </Button>
      <Status msg={msg} />
    </span>
  );
}
