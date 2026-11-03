"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Select, Textarea } from "../ui";
import { api } from "../api";
import { RECOMMENDATION_LABEL, type Recommendation } from "@/lib/core/types";

const RECS: Recommendation[] = ["strong_hire", "hire", "lean_no", "no_hire"];

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
  return { busy, msg, run, router };
}

function Status({ msg }: { msg: string }) {
  return msg ? (
    <span role="status" className="text-sm text-slate-700">
      {msg}
    </span>
  ) : null;
}

/** Start a run: current evaluator model or a model being tried, and how many times to score each case. */
export function BenchRunForm({ currentModel, models, caseCount, running, monthly }: { currentModel: string; models: string[]; caseCount: number; running: boolean; monthly: boolean }) {
  const { busy, msg, run, router } = useAction();
  const [label, setLabel] = useState("");
  const [model, setModel] = useState(currentModel);
  const [repeats, setRepeats] = useState(1);
  const calls = caseCount * repeats;
  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name (optional)">
          <Input value={label} maxLength={120} placeholder="e.g. Before switching models" onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label="Evaluator model">
          <Select value={model} onChange={(e) => setModel(e.target.value)} disabled={currentModel === "mock"}>
            <option value={currentModel}>{`${currentModel} (current)`}</option>
            {models
              .filter((m) => m !== currentModel)
              .map((m) => (
                <option key={m} value={m}>{`${m} (try it)`}</option>
              ))}
          </Select>
        </Field>
        <Field label="Score each case">
          <Select value={repeats} onChange={(e) => setRepeats(Number(e.target.value))}>
            <option value={1}>once</option>
            <option value={2}>twice (checks consistency)</option>
            <option value={3}>three times (checks consistency)</option>
          </Select>
        </Field>
      </div>
      <p className="text-xs text-slate-600">{`${caseCount} active case${caseCount === 1 ? "" : "s"} × ${repeats} = ${calls} scoring${calls === 1 ? "" : "s"}, each using the same 2–4 evaluator calls as a live round. Trying another model doesn't change what candidates get.`}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={busy || running || !caseCount}
          title={running ? "A run is in progress" : !caseCount ? "Add test cases first" : undefined}
          onClick={() =>
            run(async () => {
              const r = await api<{ id: string }>("/api/test-bench/runs", { body: { label: label || undefined, model, repeats } });
              router.push(`/app/test-bench/runs/${r.id}`);
            })
          }
        >
          Run the test bench
        </Button>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={monthly} disabled={busy} onChange={(e) => run(async () => (await api("/api/settings", { method: "PUT", body: { testBenchMonthly: e.target.checked } }), e.target.checked ? "Monthly runs turned on." : "Monthly runs turned off."))} />
          <span>Re-run automatically every month with the current model (catches drift)</span>
        </label>
        <Status msg={msg} />
      </div>
    </div>
  );
}

export function AddReviewedRounds() {
  const { busy, msg, run } = useAction();
  return (
    <span className="flex items-center gap-3">
      <Button variant="secondary" disabled={busy} onClick={() => run(async () => `${(await api<{ added: number }>("/api/test-bench/cases", { body: { fromCalibration: true } })).added} round(s) added.`)}>
        Add blind-reviewed rounds
      </Button>
      <Status msg={msg} />
    </span>
  );
}

/** Cancel or mark as baseline; refreshes itself while the run is in progress. */
export function RunActions({ runId, status, isBaseline }: { runId: string; status: string; isBaseline: boolean }) {
  const { busy, msg, run, router } = useAction();
  useEffect(() => {
    if (status !== "running") return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [status, router]);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "running" && (
        <Button variant="secondary" disabled={busy} onClick={() => confirm("Stop this run? Cases already scored are kept.") && run(async () => (await api(`/api/test-bench/runs/${runId}`, { body: { action: "cancel" } }), "Run cancelled."))}>
          Cancel run
        </Button>
      )}
      {status === "completed" && !isBaseline && (
        <Button variant="secondary" disabled={busy} onClick={() => run(async () => (await api(`/api/test-bench/runs/${runId}`, { body: { action: "baseline" } }), "This run is now the baseline."))}>
          Make this the baseline
        </Button>
      )}
      {status !== "running" && (
        <a href={`/api/test-bench/runs/${runId}/export`} className="rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
          Export CSV
        </a>
      )}
      <Status msg={msg} />
    </div>
  );
}

type ParamDef = { id: string; label: string };

function ExpectedInputs({ params, value, onChange }: { params: ParamDef[]; value: { params: Record<string, number | null>; recommendation: string }; onChange: (v: { params: Record<string, number | null>; recommendation: string }) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {params.map((p) => (
        <Field key={p.id} label={p.label}>
          <Select value={value.params[p.id] ?? ""} onChange={(e) => onChange({ ...value, params: { ...value.params, [p.id]: e.target.value ? Number(e.target.value) : null } })}>
            <option value="">— not assessable</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
      ))}
      <Field label="Expected recommendation">
        <Select value={value.recommendation} onChange={(e) => onChange({ ...value, recommendation: e.target.value })}>
          <option value="">Choose…</option>
          {RECS.map((r) => (
            <option key={r} value={r}>
              {RECOMMENDATION_LABEL[r]}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

/** Edit what people expect for a case, switch it on/off, or delete it. */
export function CaseEditor({ caseId, params, expected, notes, active, title }: { caseId: string; params: ParamDef[]; expected: { params: Record<string, number | null>; recommendation: string }; notes: string; active: boolean; title: string }) {
  const { busy, msg, run, router } = useAction();
  const [exp, setExp] = useState(expected);
  const [n, setN] = useState(notes);
  const [t, setT] = useState(title);
  return (
    <div className="space-y-4 text-sm">
      <Field label="Title">
        <Input value={t} maxLength={160} onChange={(e) => setT(e.target.value)} />
      </Field>
      <ExpectedInputs params={params} value={exp} onChange={setExp} />
      <Field label="Notes for reviewers" hint="Why these are the right scores — helps whoever reviews a disagreement later.">
        <Textarea rows={3} value={n} maxLength={2000} onChange={(e) => setN(e.target.value)} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy} onClick={() => run(async () => (await api(`/api/test-bench/cases/${caseId}`, { method: "PUT", body: { title: t, notes: n, expected: exp } }), "Saved."))}>
          Save expected scores
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => run(async () => (await api(`/api/test-bench/cases/${caseId}`, { method: "PUT", body: { active: !active } }), active ? "Left out of future runs." : "Included in future runs."))}>
          {active ? "Leave out of runs" : "Include in runs"}
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() =>
            confirm("Delete this test case? Past runs keep their numbers.") &&
            run(async () => {
              await api(`/api/test-bench/cases/${caseId}`, { method: "DELETE" });
              router.push("/app/test-bench");
            })
          }
        >
          Delete
        </Button>
        <Status msg={msg} />
      </div>
    </div>
  );
}

const EXAMPLE = `Interviewer: Tell me about a production incident you handled recently.
Candidate: Our payments API started timing out at peak. I checked the dashboards, saw database connections maxed out, and traced it to a new report query holding locks…
Interviewer: What did you change, and how did you know it worked?
Candidate: …`;

/** Write a case from scratch: no real candidate's data, so it is kept regardless of retention. */
export function WrittenCaseForm({ drives }: { drives: { id: string; title: string; rounds: { type: string; label: string; params: ParamDef[] }[] }[] }) {
  const { busy, msg, run, router } = useAction();
  const [driveId, setDriveId] = useState(drives[0]?.id ?? "");
  const drive = drives.find((d) => d.id === driveId);
  const [roundType, setRoundType] = useState(drive?.rounds[0]?.type ?? "");
  const round = drive?.rounds.find((r) => r.type === roundType) ?? drive?.rounds[0];
  const [title, setTitle] = useState("");
  const [transcript, setTranscript] = useState("");
  const [exercise, setExercise] = useState("");
  const [exp, setExp] = useState<{ params: Record<string, number | null>; recommendation: string }>({ params: {}, recommendation: "" });
  return (
    <div className="space-y-4 text-sm">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Title">
          <Input value={title} maxLength={160} placeholder="e.g. Strong backend answer, weak testing" onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Drive (role and rubric)">
          <Select
            value={driveId}
            onChange={(e) => {
              setDriveId(e.target.value);
              setRoundType(drives.find((d) => d.id === e.target.value)?.rounds[0]?.type ?? "");
              setExp({ params: {}, recommendation: exp.recommendation });
            }}
          >
            {drives.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Round">
          <Select value={round?.type ?? ""} onChange={(e) => (setRoundType(e.target.value), setExp({ params: {}, recommendation: exp.recommendation }))}>
            {drive?.rounds.map((r) => (
              <option key={r.type} value={r.type}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Transcript" hint="Start each message with “Interviewer:” or “Candidate:”. Don't paste a real candidate's interview here — add real rounds from their report instead, so they're deleted with the candidate's data.">
        <Textarea rows={12} className="font-mono text-xs" value={transcript} placeholder={EXAMPLE} onChange={(e) => setTranscript(e.target.value)} />
      </Field>
      <Field label="Written exercise or code (optional)">
        <Textarea rows={4} className="font-mono text-xs" value={exercise} onChange={(e) => setExercise(e.target.value)} />
      </Field>
      <div>
        <p className="mb-2 font-medium text-slate-700">Expected scores (what your team agrees this deserves)</p>
        {round && <ExpectedInputs params={round.params} value={exp} onChange={setExp} />}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={busy || !round || !title.trim() || !transcript.trim()}
          onClick={() =>
            run(async () => {
              const r = await api<{ id: string }>("/api/test-bench/cases/written", { body: { title, driveId, roundType: round!.type, transcript, exercise: exercise || undefined, expected: { params: Object.fromEntries(round!.params.map((p) => [p.id, exp.params[p.id] ?? null])), recommendation: exp.recommendation } } });
              router.push(`/app/test-bench/cases/${r.id}`);
            })
          }
        >
          Save test case
        </Button>
        <Status msg={msg} />
      </div>
    </div>
  );
}

/** On a candidate report: freeze this evaluated round as a test case (admins). */
export function AddToBenchButton({ reportId, caseId }: { reportId: string; caseId: string | null }) {
  const { busy, msg, run, router } = useAction();
  if (caseId)
    return (
      <a href={`/app/test-bench/cases/${caseId}`} className="text-xs text-brand-600 hover:underline">
        In the test bench
      </a>
    );
  return (
    <button
      className="text-xs text-brand-600 hover:underline disabled:opacity-50"
      disabled={busy}
      onClick={() =>
        run(async () => {
          const r = await api<{ id: string }>("/api/test-bench/cases", { body: { reportId } });
          router.push(`/app/test-bench/cases/${r.id}`);
        })
      }
    >
      Add to test bench
      {msg && <span role="status" className="ml-2 text-red-700">{msg}</span>}
    </button>
  );
}
