"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, Card, cx } from "../ui";

type Q = { qid: string; section: string; stem: string; options: string[] };
type Paper = { questions: Q[]; answers: Record<string, number>; deadlineAt: string; submitted: boolean };

const SECTION: Record<string, string> = { quant: "Quantitative aptitude", logical: "Logical reasoning", verbal: "Verbal ability", technical: "Technical fundamentals" };
const LETTERS = ["A", "B", "C", "D", "E", "F"];

function fmt(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The timed multiple-choice test: one question at a time, answers saved as they're chosen. */
export function ScreeningTest({ token, durationMin, total, sections, initial }: { token: string; durationMin: number; total: number; sections: { label: string; n: number }[]; initial: Paper | null }) {
  const [paper, setPaper] = useState<Paper | null>(initial);
  const [i, setI] = useState(0);
  const [flagged, setFlagged] = useState<string[]>([]);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ status: string; score: { percent: number | null; correct?: number; total?: number } | null } | null>(null);
  const focus = useRef(0);
  const base = `/api/c/${token}/screening`;

  const submit = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`${base}/submit`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Couldn't submit — please try again.");
      setDone(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [base]);

  useEffect(() => {
    if (!paper || done) return;
    const tick = () => {
      const s = (Date.parse(paper.deadlineAt) - Date.now()) / 1000;
      setLeft(s);
      if (s <= 0) void submit();
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [paper, done, submit]);

  useEffect(() => {
    if (!paper || done) return;
    const onVis = () => {
      if (document.hidden) focus.current++;
    };
    document.addEventListener("visibilitychange", onVis);
    const t = setInterval(() => {
      if (!focus.current) return;
      const count = focus.current;
      focus.current = 0;
      fetch(`${base}/focus`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ count }) }).catch(() => undefined);
    }, 10_000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(t);
    };
  }, [paper, done, base]);

  async function start() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${base}/start`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Couldn't start the test.");
      setPaper(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function choose(qid: string, choice: number | null) {
    if (!paper) return;
    const prev = paper.answers;
    const answers = { ...prev };
    if (choice == null) delete answers[qid];
    else answers[qid] = choice;
    setPaper({ ...paper, answers });
    const res = await fetch(`${base}/answer`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ qid, choice }) }).catch(() => null);
    if (!res || !res.ok) {
      const data = res ? await res.json().catch(() => ({})) : {};
      setError((data as { error?: { message?: string } }).error?.message ?? "Your answer wasn't saved — check your connection.");
      if (res?.status === 409) setDone({ status: "submitted", score: null });
      else setPaper((p) => (p ? { ...p, answers: prev } : p));
    } else setError("");
  }

  if (done)
    return (
      <Card>
        <h1 className="text-lg font-semibold">Test submitted — thank you</h1>
        {done.score?.percent != null && <p className="mt-2 text-sm">{`You scored ${done.score.percent}% (${done.score.correct} of ${done.score.total}).`}</p>}
        <p className="mt-2 text-sm text-slate-600">
          {done.status === "passed" ? "You can continue with your application now." : done.status === "review" ? "The hiring team will review your result and let you know the next step." : "We've recorded your answers. You'll hear from the hiring team."}
        </p>
        <Link href={`/c/${token}`} className="mt-4 inline-block text-sm font-medium text-brand-600 hover:underline">
          Back to your application →
        </Link>
      </Card>
    );

  if (!paper)
    return (
      <Card>
        <h1 className="text-lg font-semibold">Screening test</h1>
        <p className="mt-1 text-sm text-slate-600">{`${total} multiple-choice questions · ${durationMin} minutes`}</p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
          {sections.map((s) => (
            <li key={s.label}>{`${s.label}: ${s.n} question${s.n === 1 ? "" : "s"}`}</li>
          ))}
        </ul>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-slate-600">
          <li>The timer starts when you click Start and keeps running if you close the page. At the end, your answers are submitted automatically.</li>
          <li>Each question has one correct answer. There is no penalty for a wrong answer, so answer every question.</li>
          <li>You can move between questions and change answers until you submit. Your answers are saved as you go.</li>
          <li>Please stay on this page — leaving it is recorded for the hiring team.</li>
        </ul>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="mt-5 flex gap-2">
          <Button onClick={start} disabled={busy}>
            {busy ? "Starting…" : "Start the test"}
          </Button>
          <Link href={`/c/${token}`} className="rounded-lg px-3.5 py-2 text-sm text-slate-600 hover:bg-slate-100">
            Back
          </Link>
        </div>
      </Card>
    );

  const q = paper.questions[i];
  const answered = Object.keys(paper.answers).length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <p className="text-sm">
          <b>{`Question ${i + 1} of ${paper.questions.length}`}</b>
          <span className="ml-2 text-slate-600">{SECTION[q.section] ?? q.section}</span>
        </p>
        <p className="text-sm text-slate-700">{`${answered} answered`}</p>
        <p role="timer" aria-live="off" className={cx("rounded-lg px-3 py-1 font-mono text-sm", left < 60 ? "bg-red-50 text-red-800" : "bg-slate-100 text-slate-800")}>
          {fmt(left)}
        </p>
      </div>
      <Card>
        <fieldset>
          <legend className="text-base font-medium text-slate-900">{q.stem}</legend>
          <div className="mt-4 space-y-2">
            {q.options.map((o, k) => (
              <label key={k} className={cx("flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm", paper.answers[q.qid] === k ? "border-brand-600 bg-brand-50" : "border-slate-200 hover:bg-slate-50")}>
                <input type="radio" name={q.qid} className="mt-0.5" checked={paper.answers[q.qid] === k} onChange={() => choose(q.qid, k)} />
                <span>
                  <b className="mr-1">{LETTERS[k]}.</b>
                  {o}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="secondary" disabled={i === 0} onClick={() => setI(i - 1)}>
            ← Previous
          </Button>
          <Button variant="secondary" disabled={i === paper.questions.length - 1} onClick={() => setI(i + 1)}>
            Next →
          </Button>
          <Button variant="ghost" onClick={() => setFlagged(flagged.includes(q.qid) ? flagged.filter((x) => x !== q.qid) : [...flagged, q.qid])}>
            {flagged.includes(q.qid) ? "Unmark" : "Mark for review"}
          </Button>
          {paper.answers[q.qid] != null && (
            <Button variant="ghost" onClick={() => choose(q.qid, null)}>
              Clear answer
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {error}
          </p>
        )}
      </Card>
      <Card title="All questions">
        <div className="flex flex-wrap gap-1.5" role="list">
          {paper.questions.map((x, k) => (
            <button
              key={x.qid}
              role="listitem"
              aria-label={`Question ${k + 1}${paper.answers[x.qid] != null ? ", answered" : ""}${flagged.includes(x.qid) ? ", marked for review" : ""}`}
              onClick={() => setI(k)}
              className={cx("h-9 w-9 rounded-lg text-sm font-medium ring-1", k === i ? "ring-2 ring-brand-600" : "ring-slate-300", paper.answers[x.qid] != null ? "bg-brand-600 text-white" : "bg-white text-slate-800", flagged.includes(x.qid) && "outline outline-2 outline-offset-1 outline-amber-500")}
            >
              {k + 1}
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button disabled={busy} onClick={() => confirm(`Submit the test? ${paper.questions.length - answered} question(s) unanswered.`) && submit()}>
            {busy ? "Submitting…" : "Submit the test"}
          </Button>
          <span className="text-xs text-slate-600">Blue = answered · amber outline = marked for review</span>
        </div>
      </Card>
    </div>
  );
}
