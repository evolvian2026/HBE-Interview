"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, Select } from "../ui";
import { Markdown } from "./markdown";
import type { CodingWorkspace } from "@/lib/interview/exercises";
import type { RunSummary } from "@/lib/exec";

const Editor = dynamic(() => import("@monaco-editor/react").then((m) => m.default), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-slate-400">Loading editor…</div>,
});

const MONACO_LANG: Record<string, string> = { python: "python", javascript: "javascript", java: "java", cpp: "cpp" };

export function CodingPanel({
  ws,
  base,
  disabled,
  onSubmitted,
  onHint,
  onPaste,
}: {
  ws: CodingWorkspace;
  base: string;
  disabled: boolean;
  onSubmitted: (summary: RunSummary) => void;
  onHint: () => void;
  onPaste: (length: number) => void;
}) {
  const storageKey = `hbe-code-${base}-${ws.problem.id}`;
  const [language, setLanguage] = useState<string>(ws.latest?.language ?? ws.languages[0]?.id ?? "python");
  const [code, setCode] = useState<string>(() => ws.latest?.code ?? ws.starter[ws.latest?.language ?? ws.languages[0]?.id ?? "python"] ?? "");
  const [busy, setBusy] = useState<"" | "run" | "submit">("");
  const [result, setResult] = useState<RunSummary | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"problem" | "results">("problem");
  const lastSnap = useRef(code);

  // Restore an unsaved local draft after reconnect.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved && !ws.latest) {
        const d = JSON.parse(saved) as { language: string; code: string };
        setLanguage(d.language);
        setCode(d.code);
      }
    } catch {
      /* ignore */
    }
  }, [storageKey, ws.latest]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ language, code }));
    } catch {
      /* ignore */
    }
  }, [code, language, storageKey]);

  // Snapshot every 10s when changed (for replay and so the interviewer can see progress).
  useEffect(() => {
    const t = setInterval(() => {
      if (code !== lastSnap.current && !ws.submitted) {
        lastSnap.current = code;
        fetch(`${base}/code`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "snapshot", language, code }) }).catch(() => undefined);
      }
    }, 10_000);
    return () => clearInterval(t);
  }, [code, language, base, ws.submitted]);

  async function exec(action: "run" | "submit") {
    if (action === "submit" && !confirm("Submit your solution? You won't be able to change it afterwards.")) return;
    setBusy(action);
    setError("");
    try {
      const res = await fetch(`${base}/code`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, language, code }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed");
      setResult(data.results);
      setTab("results");
      lastSnap.current = code;
      if (action === "submit") onSubmitted(data.results);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  const locked = disabled || ws.submitted;
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-2">
        <Select
          value={language}
          disabled={locked}
          className="w-44"
          onChange={(e) => {
            const l = e.target.value;
            if (code.trim() === (ws.starter[language] ?? "").trim() || confirm("Switch language? Your current code will be replaced with the starter template.")) {
              setLanguage(l);
              setCode(ws.starter[l] ?? "");
            }
          }}
        >
          {ws.languages.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </Select>
        <Button variant="secondary" disabled={locked || !!busy} onClick={() => exec("run")}>
          {busy === "run" ? "Running…" : "Run samples"}
        </Button>
        <Button disabled={locked || !!busy} onClick={() => exec("submit")}>
          {busy === "submit" ? "Submitting…" : ws.submitted ? "Submitted" : "Submit"}
        </Button>
        <Button variant="ghost" disabled={locked} onClick={onHint} title="Ask the interviewer for a hint (hints are noted in the evaluation)">
          Ask for a hint
        </Button>
        {ws.submitted && ws.lastSubmit && <Badge tone={ws.lastSubmit.passed === ws.lastSubmit.total ? "green" : "amber"}>Hidden tests: {ws.lastSubmit.passed}/{ws.lastSubmit.total}</Badge>}
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-h-0 border-b border-slate-200" onPaste={(e) => onPaste(e.clipboardData.getData("text").length)}>
          <Editor
            height="100%"
            language={MONACO_LANG[language]}
            value={code}
            onChange={(v) => setCode(v ?? "")}
            options={{ minimap: { enabled: false }, fontSize: 13, readOnly: locked, scrollBeyondLastLine: false, tabSize: 4, automaticLayout: true }}
          />
        </div>
        <div className="flex min-h-0 flex-col">
          <div className="flex gap-1 border-b border-slate-200 px-2 pt-1 text-xs">
            {(["problem", "results"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`rounded-t-md px-3 py-1.5 ${tab === t ? "bg-slate-100 font-medium" : "text-slate-500"}`}>
                {t === "problem" ? "Problem" : "Results"}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3 text-sm">
            {tab === "problem" ? (
              <div>
                <p className="mb-1 font-semibold">
                  {ws.problem.title} <Badge>{ws.problem.difficulty}</Badge>
                </p>
                <Markdown text={ws.problem.statement} />
                {ws.problem.samples.map((s, i) => (
                  <div key={i} className="mt-2 grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-xs text-slate-500">Sample input {i + 1}</p>
                      <pre className="rounded bg-slate-900 p-2 text-xs text-slate-100">{s.input}</pre>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Expected output</p>
                      <pre className="rounded bg-slate-900 p-2 text-xs text-slate-100">{s.output}</pre>
                    </div>
                  </div>
                ))}
              </div>
            ) : result ? (
              <div className="space-y-2">
                {result.unavailable && <p className="text-amber-700">{result.unavailable}</p>}
                {result.compileError && <pre className="whitespace-pre-wrap rounded bg-red-50 p-2 text-xs text-red-700">{result.compileError}</pre>}
                <p className="font-medium">
                  {result.passed}/{result.total} tests passed
                </p>
                {result.results.map((r, i) => (
                  <div key={i} className="rounded border border-slate-200 p-2 text-xs">
                    <p>
                      Test {i + 1}: <Badge tone={r.verdict === "AC" ? "green" : "red"}>{VERDICT[r.verdict] ?? r.verdict}</Badge> {r.timeMs != null && <span className="text-slate-400">{r.timeMs} ms</span>}
                    </p>
                    {r.expected !== undefined && r.verdict !== "AC" && (
                      <div className="mt-1 grid grid-cols-2 gap-2">
                        <pre className="whitespace-pre-wrap rounded bg-slate-50 p-1">Your output:{"\n"}{r.stdout || "(empty)"}</pre>
                        <pre className="whitespace-pre-wrap rounded bg-slate-50 p-1">Expected:{"\n"}{r.expected}</pre>
                      </div>
                    )}
                    {r.stderr && <pre className="mt-1 whitespace-pre-wrap text-red-600">{r.stderr}</pre>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-500">Run your code to see results here.</p>
            )}
            {error && <p className="mt-2 text-red-600">{error}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

const VERDICT: Record<string, string> = { AC: "Passed", WA: "Wrong answer", TLE: "Time limit", RE: "Runtime error", CE: "Compile error", ERR: "Error" };
