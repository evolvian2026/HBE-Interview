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

/** Decide on a test held for review. */
export function ScreeningReview({ candidacyId }: { candidacyId: string }) {
  const { busy, msg, run } = useAction();
  const [note, setNote] = useState("");
  const go = (decision: "pass" | "fail") => run(async () => (await api(`/api/candidacies/${candidacyId}/screening`, { body: { decision, note: note || undefined } }), decision === "pass" ? "The candidate can continue." : "Not continuing — the candidate has been told."));
  return (
    <div className="mt-3 space-y-2 text-sm">
      <Field label="Note (optional)">
        <Input value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy} onClick={() => go("pass")}>
          Let them continue
        </Button>
        <Button variant="danger" disabled={busy} onClick={() => confirm("Reject this candidate? They'll get the rejection email.") && go("fail")}>
          Don&apos;t continue
        </Button>
        <Status msg={msg} />
      </div>
    </div>
  );
}

export function AddQuestionForm() {
  const { busy, msg, run } = useAction();
  const blank = { section: "quant", difficulty: "medium", stem: "", options: ["", "", "", ""], answer: 0, explanation: "" };
  const [q, setQ] = useState(blank);
  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Section">
          <Select value={q.section} onChange={(e) => setQ({ ...q, section: e.target.value })}>
            <option value="quant">Quantitative aptitude</option>
            <option value="logical">Logical reasoning</option>
            <option value="verbal">Verbal ability</option>
            <option value="technical">Technical fundamentals</option>
          </Select>
        </Field>
        <Field label="Difficulty">
          <Select value={q.difficulty} onChange={(e) => setQ({ ...q, difficulty: e.target.value })}>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </Select>
        </Field>
      </div>
      <Field label="Question">
        <Textarea rows={2} value={q.stem} maxLength={2000} onChange={(e) => setQ({ ...q, stem: e.target.value })} />
      </Field>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-slate-700">Options (select the correct one)</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {q.options.map((o, i) => (
            <label key={i} className="flex items-center gap-2">
              <input type="radio" name="correct" checked={q.answer === i} onChange={() => setQ({ ...q, answer: i })} aria-label={`Option ${"ABCD"[i]} is correct`} />
              <Input value={o} maxLength={500} placeholder={`Option ${"ABCD"[i]}`} aria-label={`Option ${"ABCD"[i]}`} onChange={(e) => setQ({ ...q, options: q.options.map((x, j) => (j === i ? e.target.value : x)) })} />
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Explanation (for staff, optional)">
        <Input value={q.explanation} maxLength={2000} onChange={(e) => setQ({ ...q, explanation: e.target.value })} />
      </Field>
      <div className="flex items-center gap-3">
        <Button disabled={busy || !q.stem.trim()} onClick={() => run(async () => (await api("/api/question-bank", { body: { ...q, explanation: q.explanation || undefined } }), setQ(blank), "Question added."))}>
          Add question
        </Button>
        <Status msg={msg} />
      </div>
    </div>
  );
}

export function ImportQuestions() {
  const { busy, msg, run } = useAction();
  const [problems, setProblems] = useState<string[]>([]);
  return (
    <div className="space-y-2 text-sm">
      <label className="inline-block cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50">
        Import CSV…
        <input
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            const csv = await f.text();
            await run(async () => {
              const r = await api<{ added: number; problems: string[] }>("/api/question-bank/import", { body: { csv } });
              setProblems(r.problems);
              return `${r.added} question${r.added === 1 ? "" : "s"} imported${r.problems.length ? `; ${r.problems.length} row(s) skipped` : ""}.`;
            });
          }}
        />
      </label>
      <span className="ml-3 text-xs text-slate-600">Columns: section, difficulty, question, a, b, c, d, answer (A–D), explanation</span>
      <div>
        <Status msg={msg} />
      </div>
      {problems.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-red-800">
          {problems.slice(0, 20).map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {busy && <span className="text-xs text-slate-600">Importing…</span>}
    </div>
  );
}

export function QuestionToggle({ id, active }: { id: string; active: boolean }) {
  const { busy, run } = useAction();
  return (
    <button className="text-xs text-brand-700 hover:underline disabled:opacity-50" disabled={busy} onClick={() => run(async () => void (await api(`/api/question-bank/${id}`, { method: "PATCH", body: { active: !active } })))}>
      {active ? "Retire" : "Use again"}
    </button>
  );
}
