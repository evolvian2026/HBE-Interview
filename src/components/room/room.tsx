"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Badge, BrandMark, Button, Card, Textarea, cx } from "../ui";
import { Markdown } from "./markdown";
import { postSSE } from "./sse";
import { speak, stopSpeaking, useDictation, voiceSupport } from "./voice";
import { CodingPanel } from "./coding-panel";
import { TextExercisePanel } from "./text-exercise-panel";
import { PracticalFitPanel } from "./practical-fit-panel";
import { RepoPanel } from "./repo-panel";
import { PrioritizationPanel } from "./prioritization-panel";
import { SnippetEditor } from "./snippet-editor";
import { WebcamProctor } from "./webcam";
import { FeedbackSurvey } from "../candidate/feedback-survey";
import type { PublicState, TurnKind } from "@/lib/interview/orchestrator";
import type { Workspace } from "@/lib/interview/exercises";
import { languageInfo } from "@/lib/core/languages";

interface ChatMessage {
  id: string;
  role: "ai" | "candidate";
  content: string;
  pending?: boolean;
}

interface Props {
  token: string;
  roundIndex: number;
  roundLabel: string;
  roundType: "technical" | "managerial" | "hr";
  durationMin: number;
  sections: string[];
  personaName: string;
  companyName: string;
  hasExercises: boolean;
  initialSessionId: string | null;
  languages: string[];
  webcam: { intervalSec: number } | null;
  /** Hiring organisation's logo/name (branded header). */
  brand?: { name: string; logoUrl: string | null };
  /** Pause allowance, and the approved extra time already folded into durationMin (accommodation). */
  pauses: { count: number; minutes: number };
  extraTimePct: number;
}

type IntegrityEvent = { type: "blur" | "paste" | "copy" | "fast_answer" | "camera_off"; payload?: Record<string, string | number | boolean> };

function uuid() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function fmt(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function InterviewRoom(props: Props) {
  const [sessionId, setSessionId] = useState<string | null>(props.initialSessionId);
  const [mode, setMode] = useState<"text" | "voice">("text");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [state, setState] = useState<PublicState | null>(null);
  const [workspace, setWorkspace] = useState<Workspace>({ kind: "none" });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; retry?: () => void } | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(props.durationMin * 60);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [starting, setStarting] = useState(false);
  const [snippetOpen, setSnippetOpen] = useState(false);
  const base = sessionId ? `/api/c/${props.token}/sessions/${sessionId}` : "";
  const integrity = useRef<IntegrityEvent[]>([]);
  const blurAt = useRef<number | null>(null);
  const typingStart = useRef<number | null>(null);
  const pastedChars = useRef(0);
  const chatEnd = useRef<HTMLDivElement>(null);
  const openedRef = useRef(false);
  const [language, setLanguage] = useState<string>(props.languages[0] ?? "en");
  const speechLang = languageInfo(language).speech;
  // Detected after mount so server and first client render match (avoids a hydration mismatch in Chrome).
  const [support, setSupport] = useState({ stt: false, tts: false });
  useEffect(() => setSupport(voiceSupport()), []);

  const dictation = useDictation(
    useCallback((t: string) => {
      setInput((x) => (x ? `${x} ${t}` : t));
      if (!typingStart.current) typingStart.current = Date.now();
    }, []),
    speechLang,
  );

  /* ------------------------------ Load & stream ------------------------------ */

  const applyState = useCallback((s: PublicState) => {
    setState(s);
    setTimeLeft(s.timeLeftSec);
    setMode(s.mode);
    if (s.language) setLanguage(s.language);
  }, []);

  const sendTurn = useCallback(
    async (kind: TurnKind, text: string, clientMsgId = uuid()) => {
      if (!base) return;
      setBusy(true);
      setError(null);
      stopSpeaking();
      const aiId = `ai-${clientMsgId}`;
      setMessages((m) => {
        const next = m.filter((x) => x.id !== aiId && x.id !== `c-${clientMsgId}`);
        if (kind !== "open") next.push({ id: `c-${clientMsgId}`, role: "candidate", content: text || (kind === "skip" ? "(skipped)" : "") });
        next.push({ id: aiId, role: "ai", content: "", pending: true });
        return next;
      });
      let full = "";
      let ended = false;
      try {
        await postSSE(`${base}/turns`, { clientMsgId, text, kind, inputMode: mode }, (type, data) => {
          const d = data as Record<string, unknown>;
          if (type === "token") {
            full += String(d.text);
            setMessages((m) => m.map((x) => (x.id === aiId ? { ...x, content: full } : x)));
          } else if (type === "workspace") setWorkspace(d.workspace as Workspace);
          else if (type === "state") applyState(d.state as PublicState);
          else if (type === "done") {
            ended = !!d.ended;
            setMessages((m) => m.map((x) => (x.id === aiId ? { ...x, pending: false } : x)));
          } else if (type === "error") {
            throw Object.assign(new Error(String(d.message)), { retryable: !!d.retryable });
          }
        });
        if (full && mode === "voice" && autoSpeak) speak(full, speechLang);
        if (ended) setState((s) => (s ? { ...s, ended: true, status: "ended" } : s));
      } catch (e) {
        const err = e as Error & { retryable?: boolean; status?: number };
        setMessages((m) => m.filter((x) => x.id !== aiId || x.content));
        setError({ message: err.message, retry: err.retryable !== false ? () => sendTurn(kind, text, clientMsgId) : undefined });
      } finally {
        setBusy(false);
      }
    },
    [base, mode, autoSpeak, applyState],
  );

  const load = useCallback(async () => {
    if (!base) return;
    const res = await fetch(`${base}/state`);
    if (!res.ok) {
      setError({ message: "Could not load the interview. Please refresh." });
      return;
    }
    const data = await res.json();
    applyState(data.state);
    setWorkspace(data.workspace);
    const msgs: ChatMessage[] = data.messages.map((m: { id: string; role: "ai" | "candidate"; content: string }) => ({ id: m.id, role: m.role, content: m.content }));
    setMessages(msgs);
    // Guard against double-open (React StrictMode runs effects twice in development).
    if (!data.state.ended && msgs.length === 0 && !openedRef.current) {
      openedRef.current = true;
      sendTurn("open", "");
    }
  }, [base, applyState, sendTurn]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  /* ------------------------ Timer, heartbeat, integrity ----------------------- */

  useEffect(() => {
    if (!state || state.ended || state.paused) return;
    const t = setInterval(() => setTimeLeft((x) => Math.max(0, x - 1)), 1000);
    return () => clearInterval(t);
  }, [state]);

  useEffect(() => {
    if (!base || state?.ended) return;
    const hb = setInterval(() => fetch(`${base}/heartbeat`, { method: "POST" }).catch(() => undefined), 15_000);
    const flush = setInterval(() => {
      const events = integrity.current.splice(0);
      if (events.length) fetch(`${base}/integrity`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ events }) }).catch(() => undefined);
    }, 10_000);
    const onVis = () => {
      if (document.hidden) blurAt.current = Date.now();
      else if (blurAt.current) {
        integrity.current.push({ type: "blur", payload: { durationMs: Date.now() - blurAt.current } });
        blurAt.current = null;
      }
    };
    const onCopy = () => integrity.current.push({ type: "copy" });
    document.addEventListener("visibilitychange", onVis);
    document.addEventListener("copy", onCopy);
    return () => {
      clearInterval(hb);
      clearInterval(flush);
      document.removeEventListener("visibilitychange", onVis);
      document.removeEventListener("copy", onCopy);
    };
  }, [base, state?.ended]);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const onCameraOff = useCallback(() => {
    integrity.current.push({ type: "camera_off" });
  }, []);

  const onPaste = useCallback((length: number, target = "answer") => {
    integrity.current.push({ type: "paste", payload: { length, target } });
    if (target === "answer") pastedChars.current += length;
  }, []);

  /* --------------------------------- Actions -------------------------------- */

  async function start() {
    setStarting(true);
    setError(null);
    try {
      if (mode === "voice") await navigator.mediaDevices?.getUserMedia({ audio: true }).then((s) => s.getTracks().forEach((t) => t.stop()));
      const res = await fetch(`/api/c/${props.token}/rounds/${props.roundIndex}/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode, language }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Could not start the round");
      setSessionId(data.sessionId);
    } catch (e) {
      setError({ message: (e as Error).message });
    } finally {
      setStarting(false);
    }
  }

  function submitAnswer() {
    const text = input.trim();
    if (!text || busy) return;
    if (dictation.listening) dictation.stop();
    const elapsed = typingStart.current ? (Date.now() - typingStart.current) / 1000 : 0;
    if (text.length > 300 && elapsed < 5 && pastedChars.current < text.length / 2) integrity.current.push({ type: "fast_answer", payload: { length: text.length, seconds: Math.round(elapsed) } });
    typingStart.current = null;
    pastedChars.current = 0;
    setInput("");
    sendTurn("answer", text);
  }

  async function control(action: "pause" | "resume") {
    const res = await fetch(`${base}/control`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    const data = await res.json();
    if (!res.ok) setError({ message: data?.error?.message ?? "Failed" });
    else applyState(data.state);
  }

  const lastAi = [...messages].reverse().find((m) => m.role === "ai" && m.content);
  const ended = !!state?.ended;
  const paused = !!state?.paused;
  const hasWorkspace = workspace.kind !== "none" && !ended;

  /* ---------------------------------- Lobby --------------------------------- */

  if (!sessionId) {
    const wide = typeof window !== "undefined" ? window.innerWidth >= 1024 : true;
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <div className="mb-6">
          <BrandMark brand={props.brand} />
        </div>
        <Card>
          <h1 className="text-lg font-semibold">
            Round {props.roundIndex + 1}: {props.roundLabel}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            About {props.durationMin} minutes with {props.personaName}, an AI interviewer at {props.companyName}. Sections: {props.sections.join(" · ")}.
          </p>
          <div className="mt-4 space-y-2 text-sm">
            <Check ok label="Browser supports live interview streaming" />
            <Check ok={!props.hasExercises || wide} label={props.hasExercises ? "Screen is wide enough for the exercise panel (1024px+)" : "Screen size OK"} warn={props.hasExercises && !wide ? "Please use a laptop or desktop for this round." : undefined} />
            <Check ok={support.stt && support.tts} label="Voice mode available in this browser" warn={!support.stt ? "Voice input needs Chrome or Edge. You can still use text." : undefined} />
          </div>
          {props.languages.length > 1 && (
            <label className="mt-5 block text-sm">
              <span className="mb-1 block font-medium">Interview language</span>
              <select className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm" value={language} onChange={(e) => setLanguage(e.target.value)}>
                {props.languages.map((c) => (
                  <option key={c} value={c}>
                    {languageInfo(c).native} ({languageInfo(c).label})
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-slate-600">The interviewer will speak and write in this language. Coding problems and technical terms stay in English.</span>
            </label>
          )}
          <fieldset className="mt-5">
            <legend className="mb-2 text-sm font-medium">How would you like to answer?</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(["text", "voice"] as const).map((m) => (
                <label key={m} className={cx("cursor-pointer rounded-lg border p-3 text-sm", mode === m ? "border-brand-500 bg-brand-50" : "border-slate-200", m === "voice" && !support.stt && "cursor-not-allowed opacity-50")}>
                  <input type="radio" name="mode" className="mr-2" disabled={m === "voice" && !support.stt} checked={mode === m} onChange={() => setMode(m)} />
                  <b>{m === "text" ? "Text" : "Voice"}</b>
                  <span className="mt-1 block text-xs text-slate-600">{m === "text" ? "Type your answers." : "The interviewer speaks; you answer by voice (you can edit the transcript before sending)."}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <ul className="mt-5 list-disc space-y-1 pl-5 text-xs text-slate-500">
            <li>The timer starts when you click Start. Your progress is saved continuously — if you lose connection, reopen your link within 15 minutes.</li>
            <li>{`You can skip up to 3 questions and pause ${props.pauses.count === 2 ? "twice" : `${props.pauses.count} times`} (${props.pauses.minutes} minutes each).`}</li>
            {(props.extraTimePct > 0 || props.pauses.count > 2) && (
              <li>{`Your approved adjustments apply to this round${props.extraTimePct > 0 ? `: ${props.extraTimePct}% extra time` : ""}${props.pauses.count > 2 ? `${props.extraTimePct > 0 ? " and" : ":"} extra breaks` : ""}.`}</li>
            )}
            {props.webcam && <li>Webcam proctoring is on: your browser will ask for camera access. A small photo is taken about every {props.webcam.intervalSec < 90 ? `${props.webcam.intervalSec} seconds` : `${Math.round(props.webcam.intervalSec / 60)} minutes`} and only checked for whether one person is present.</li>}
          </ul>
          {error && <p className="mt-3 text-sm text-red-600">{error.message}</p>}
          <div className="mt-5 flex gap-2">
            <Button onClick={start} disabled={starting}>
              {starting ? "Starting…" : "Start round"}
            </Button>
            <Link href={`/c/${props.token}`} className="rounded-lg px-3.5 py-2 text-sm text-slate-600 hover:bg-slate-100">
              Back
            </Link>
          </div>
        </Card>
      </main>
    );
  }

  /* ---------------------------------- Room ---------------------------------- */

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
        <BrandMark brand={props.brand} className="hidden md:inline-flex" />
        <div className="text-sm">
          <p className="font-medium">{props.roundLabel}</p>
          <p className="text-xs text-slate-500">with {props.personaName} (AI interviewer)</p>
        </div>
        <ol className="mx-auto hidden items-center gap-1 lg:flex">
          {state?.sections.map((s, i) => (
            <li key={s.key} className={cx("rounded-full px-2.5 py-1 text-xs", s.status === "done" ? "bg-emerald-50 text-emerald-700" : i === state.current && !ended ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600")}>
              {s.title}
            </li>
          ))}
        </ol>
        <div className="ml-auto flex items-center gap-2">
          {props.webcam && <WebcamProctor base={base} intervalSec={props.webcam.intervalSec} active={!ended} onCameraOff={onCameraOff} />}
          {!ended && (
            <span className={cx("rounded-md px-2 py-1 font-mono text-sm", timeLeft <= 60 ? "bg-red-50 text-red-700" : timeLeft <= 300 ? "bg-amber-50 text-amber-800" : "bg-slate-100")}>
              {paused ? "Paused" : fmt(timeLeft)}
            </span>
          )}
          {!ended &&
            (paused ? (
              <Button variant="secondary" onClick={() => control("resume")}>Resume</Button>
            ) : (
              <Button variant="ghost" disabled={busy || !state?.pausesLeft} onClick={() => control("pause")} title={`${state?.pausesLeft ?? 0} pause(s) left`}>
                I need a moment
              </Button>
            ))}
        </div>
      </header>

      <div className={cx("grid min-h-0 flex-1", hasWorkspace ? "lg:grid-cols-[minmax(360px,2fr)_3fr]" : "grid-cols-1")}>
        <section className={cx("flex min-h-0 flex-col", !hasWorkspace && "mx-auto w-full max-w-3xl")}>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {messages.map((m) => (
              <div key={m.id} id={m.id} className={cx("flex", m.role === "candidate" ? "justify-end" : "justify-start")}>
                <div className={cx("max-w-[85%] rounded-2xl px-4 py-2.5 text-sm", m.role === "candidate" ? "bg-brand-600 text-white" : "border border-slate-200 bg-white")}>
                  {m.role === "ai" ? m.content ? <div dir="auto"><Markdown text={m.content} /></div> : <TypingDots /> : <p dir="auto" className="whitespace-pre-wrap">{m.content}</p>}
                </div>
              </div>
            ))}
            {ended && (
              <Card>
                <p className="font-medium">This round is complete — thank you!</p>
                <p className="mt-1 text-sm text-slate-600">Your responses have been submitted. The hiring team will review them and let you know about next steps.</p>
                <div className="mt-3">
                  <FeedbackSurvey token={props.token} roundIndex={props.roundIndex} roundLabel={props.roundLabel} />
                </div>
                <Link href={`/c/${props.token}`} className="mt-3 inline-block text-sm font-medium text-brand-600 hover:underline">
                  Back to your interview page →
                </Link>
              </Card>
            )}
            <div ref={chatEnd} />
          </div>

          {error && (
            <div className="mx-4 mb-2 flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <span>{error.message}</span>
              {error.retry && (
                <Button variant="secondary" onClick={error.retry} disabled={busy}>
                  Retry
                </Button>
              )}
            </div>
          )}

          {!ended && (
            <div className="border-t border-slate-200 bg-white p-3">
              {paused ? (
                <p className="py-3 text-center text-sm text-slate-600">Paused. Take a breath — click Resume when you&apos;re ready {`(auto-resumes after ${props.pauses.minutes} minutes).`}</p>
              ) : (
                <>
                  {snippetOpen && <SnippetEditor onClose={() => setSnippetOpen(false)} onInsert={(f) => setInput((x) => `${x}${f}`)} />}
                  <Textarea
                    dir="auto"
                    rows={3}
                    value={dictation.interim ? `${input} ${dictation.interim}`.trim() : input}
                    placeholder={mode === "voice" ? "Click the mic and speak — your words appear here. Edit if needed, then Send." : "Type your answer… (Enter to send, Shift+Enter for a new line)"}
                    maxLength={4000}
                    disabled={busy}
                    onChange={(e) => {
                      if (!typingStart.current) typingStart.current = Date.now();
                      setInput(e.target.value);
                    }}
                    onPaste={(e) => onPaste(e.clipboardData.getData("text").length)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        submitAnswer();
                      }
                    }}
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button onClick={submitAnswer} disabled={busy || !input.trim()}>
                      {busy ? "Waiting…" : "Send"}
                    </Button>
                    {mode === "voice" && (
                      <Button variant={dictation.listening ? "danger" : "secondary"} onClick={() => (dictation.listening ? dictation.stop() : (stopSpeaking(), dictation.start()))} disabled={busy}>
                        {dictation.listening ? "● Stop mic" : "🎤 Speak"}
                      </Button>
                    )}
                    <Button variant="ghost" disabled={busy} onClick={() => setSnippetOpen((x) => !x)} title="Write a code or SQL snippet into your answer">
                      {"</>"} Code
                    </Button>
                    <Button variant="ghost" disabled={!lastAi} onClick={() => lastAi && (mode === "voice" ? speak(lastAi.content, speechLang) : document.getElementById(lastAi.id)?.scrollIntoView())}>
                      Repeat
                    </Button>
                    <Button variant="ghost" disabled={busy || !state?.skipsLeft} onClick={() => confirm("Skip this question? Skipped questions count as not answered.") && sendTurn("skip", "")}>
                      Skip ({state?.skipsLeft ?? 0} left)
                    </Button>
                    {mode === "voice" && (
                      <label className="ml-auto flex items-center gap-1 text-xs text-slate-500">
                        <input type="checkbox" checked={autoSpeak} onChange={(e) => setAutoSpeak(e.target.checked)} /> Read questions aloud
                      </label>
                    )}
                    <span className="ml-auto text-xs text-slate-500">{input.length}/4000</span>
                  </div>
                  {dictation.error && <p className="mt-1 text-xs text-red-600">{dictation.error}</p>}
                </>
              )}
            </div>
          )}
        </section>

        {hasWorkspace && (
          <aside className="min-h-0 border-l border-slate-200 bg-white">
            {workspace.kind === "coding" && (
              <CodingPanel
                key={workspace.problem.id}
                ws={workspace}
                base={base}
                disabled={busy || paused}
                onPaste={(n) => onPaste(n, "editor")}
                onHint={() => sendTurn("hint", "Could I get a hint, please?")}
                onSubmitted={(r) => sendTurn("submitted", `I've submitted my solution (${r.passed}/${r.total} hidden tests passed).`)}
              />
            )}
            {(workspace.kind === "system_design" || workspace.kind === "domain_case" || workspace.kind === "mgmt_case") && (
              <TextExercisePanel key={workspace.title} ws={workspace} base={base} disabled={busy || paused} onPaste={(n) => onPaste(n, "exercise")} onSubmit={() => sendTurn("submitted", "I've submitted my written response.")} />
            )}
            {workspace.kind === "prioritization" && (
              <PrioritizationPanel key={workspace.title} ws={workspace} base={base} disabled={busy || paused} onSubmit={() => sendTurn("submitted", "I've submitted my ranking and rationale.")} />
            )}
            {workspace.kind === "practical_fit" && <PracticalFitPanel ws={workspace} base={base} disabled={busy || paused} onConfirmed={() => sendTurn("submitted", "I've confirmed my details in the form.")} />}
            {workspace.kind === "repo" && <RepoPanel ws={workspace} />}
          </aside>
        )}
      </div>
    </div>
  );
}

function Check({ ok, label, warn }: { ok: boolean; label: string; warn?: string }) {
  return (
    <div className="flex items-start gap-2">
      <Badge tone={ok ? "green" : "amber"}>{ok ? "OK" : "Check"}</Badge>
      <span>
        {label}
        {warn && <span className="block text-xs text-amber-700">{warn}</span>}
      </span>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex gap-1 py-1" aria-label="Interviewer is typing">
      {[0, 1, 2].map((i) => (
        <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: `${i * 120}ms` }} />
      ))}
    </span>
  );
}
