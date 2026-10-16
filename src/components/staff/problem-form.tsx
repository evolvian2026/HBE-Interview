"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Field, Input, Select, Textarea } from "../ui";
import { api } from "../api";

type Test = { input: string; output: string };
type Validation = { ok: boolean; passed: number; total: number; compileError?: string; unavailable?: string; failures: { test: string; verdict: string; stdout: string; stderr: string }[] };

/** Tests are entered as blocks separated by a line containing only "---", each block "input === output". */
function parseTests(text: string): Test[] {
  return text
    .split(/^\s*---\s*$/m)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((b) => {
      const [input, output = ""] = b.split(/^\s*===\s*$/m);
      return { input: input.trim() + "\n", output: output.trim() };
    });
}

export function ProblemForm({ driveId }: { driveId: string }) {
  const router = useRouter();
  const [f, setF] = useState({ title: "", difficulty: "medium", statement: "", samples: "", hidden: "", referenceLanguage: "python", referenceCode: "" });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Validation | null>(null);
  const [error, setError] = useState("");
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Card title="Add a problem">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Title">
          <Input value={f.title} onChange={(e) => set("title", e.target.value)} />
        </Field>
        <Field label="Difficulty">
          <Select value={f.difficulty} onChange={(e) => set("difficulty", e.target.value)}>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </Select>
        </Field>
        <Field label="Statement (Markdown; describe input and output format on stdin/stdout)" className="md:col-span-2">
          <Textarea rows={6} value={f.statement} onChange={(e) => set("statement", e.target.value)} />
        </Field>
        <Field label="Sample tests (visible to the candidate)" hint={'Format: input, a line "===", expected output. Separate tests with a line "---".'}>
          <Textarea rows={8} className="font-mono text-xs" value={f.samples} onChange={(e) => set("samples", e.target.value)} placeholder={"3\n1 2 3\n===\n6\n---\n1\n5\n===\n5"} />
        </Field>
        <Field label="Hidden tests (at least 3; used for scoring)" hint="Same format. Include edge cases.">
          <Textarea rows={8} className="font-mono text-xs" value={f.hidden} onChange={(e) => set("hidden", e.target.value)} />
        </Field>
        <Field label="Reference solution language">
          <Select value={f.referenceLanguage} onChange={(e) => set("referenceLanguage", e.target.value)}>
            <option value="python">Python 3</option>
            <option value="javascript">JavaScript</option>
            <option value="java">Java (class Main)</option>
            <option value="cpp">C++</option>
          </Select>
        </Field>
        <Field label="Reference solution (must pass every test)" className="md:col-span-2">
          <Textarea rows={8} className="font-mono text-xs" value={f.referenceCode} onChange={(e) => set("referenceCode", e.target.value)} />
        </Field>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {result && (
        <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
          <Badge tone={result.ok ? "green" : "red"}>{result.ok ? "Validated — problem is live for this drive" : "Validation failed — not used until fixed"}</Badge>{" "}
          {result.passed}/{result.total} tests passed {result.unavailable && `· ${result.unavailable}`}
          {result.compileError && <pre className="mt-2 whitespace-pre-wrap text-xs text-red-700">{result.compileError}</pre>}
          {result.failures.slice(0, 5).map((x) => (
            <p key={x.test} className="mt-1 text-xs">
              {x.test}: {x.verdict} {x.stderr && `— ${x.stderr}`}
            </p>
          ))}
        </div>
      )}
      <Button
        className="mt-4"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          setResult(null);
          try {
            const r = await api<{ validation: Validation }>(`/api/drives/${driveId}/problems`, {
              body: { ...f, samples: parseTests(f.samples), hidden: parseTests(f.hidden) },
            });
            setResult(r.validation);
            router.refresh();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Validating…" : "Validate & save"}
      </Button>
    </Card>
  );
}

export function DeleteProblemButton({ id }: { id: string }) {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      onClick={async () => {
        if (!confirm("Delete this problem?")) return;
        await api(`/api/problems/${id}`, { method: "DELETE" });
        router.refresh();
      }}
    >
      Delete
    </Button>
  );
}
