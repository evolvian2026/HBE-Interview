/**
 * Server-owned interview state machine (ARCHITECTURE §8). Pure functions: (state, input, now) → new state.
 * The LLM proposes actions via tools; these functions decide whether they are allowed.
 */
import type { ExerciseKind, RoundConfig, RoundType } from "./types";

export interface SectionState {
  key: string;
  title: string;
  minutes: number;
  minQ: number;
  maxQ: number;
  exercise?: ExerciseKind;
  status: "pending" | "active" | "done";
  askedQ: number;
  startedAt?: string;
  endedAt?: string;
}

export interface ExerciseState {
  sectionKey: string;
  kind: ExerciseKind;
  refId: string;
  openedAt: string;
  submittedAt?: string;
  hintsUsed: number;
  maxHintLevel: number;
}

export interface SessionState {
  v: 1;
  roundType: RoundType;
  sections: SectionState[];
  current: number;
  pause: { count: number; usedSec: number; pausedAt?: string };
  coverage: Record<string, { asked: number; best?: number; struggled: boolean }>;
  followUps: number;
  usedRefs: string[];
  skipsUsed: number;
  exercises: Record<string, ExerciseState>;
  rollingSummary: string;
  summarizedThroughSeq: number;
  seq: number;
  wrapping: boolean;
  ended: boolean;
  hintRequested?: boolean;
  /** Pre-selected content for the round, e.g. { scenarios: [...] } for the Managerial round. */
  plan?: Record<string, string[]>;
  /** Candidate questions the AI could not answer (HR/wrap-up), for recruiter follow-up. */
  followUpQuestions?: string[];
}

export const LIMITS = {
  maxFollowUps: 2,
  maxSkips: 3,
  maxPauses: 2,
  maxPauseSec: 120,
  wrapUpAtSecLeft: 120,
  disconnectGraceSec: 60,
};

export function initState(round: RoundConfig, params: string[]): SessionState {
  const sections = round.sections
    .filter((s) => s.enabled)
    .map<SectionState>((s) => ({
      key: s.key,
      title: s.title,
      minutes: s.minutes,
      minQ: s.minQ,
      maxQ: s.maxQ,
      exercise: s.exercise,
      status: "pending",
      askedQ: 0,
    }));
  return {
    v: 1,
    roundType: round.type,
    sections,
    current: 0,
    pause: { count: 0, usedSec: 0 },
    coverage: Object.fromEntries(params.map((p) => [p, { asked: 0, struggled: false }])),
    followUps: 0,
    usedRefs: [],
    skipsUsed: 0,
    exercises: {},
    rollingSummary: "",
    summarizedThroughSeq: 0,
    seq: 0,
    wrapping: false,
    ended: false,
  };
}

export function clone<T>(x: T): T {
  return structuredClone(x);
}

export function currentSection(state: SessionState): SectionState | undefined {
  return state.sections[state.current];
}

export function startFirstSection(state: SessionState, now: Date): SessionState {
  const s = clone(state);
  const sec = s.sections[0];
  if (sec) {
    sec.status = "active";
    sec.startedAt = now.toISOString();
  }
  return s;
}

export function sectionElapsedSec(sec: SectionState, now: Date): number {
  if (!sec.startedAt) return 0;
  return Math.max(0, (now.getTime() - Date.parse(sec.startedAt)) / 1000);
}

export function timeLeftSec(deadlineAt: Date | string | null | undefined, now: Date, state?: SessionState): number {
  if (!deadlineAt) return 0;
  const deadline = typeof deadlineAt === "string" ? Date.parse(deadlineAt) : deadlineAt.getTime();
  const pausedNow = state?.pause.pausedAt ? (now.getTime() - Date.parse(state.pause.pausedAt)) / 1000 : 0;
  return Math.max(0, Math.round((deadline - now.getTime()) / 1000 + pausedNow));
}

export type AdvanceReason = "max_questions" | "time" | "agent" | "round_time" | "skip";

export interface AdvanceCheck {
  advance: boolean;
  reason?: AdvanceReason;
  blocked?: string;
}

/** Decide whether the current section should close. */
export function checkAdvance(
  state: SessionState,
  now: Date,
  opts: { agentRequested?: boolean } = {},
): AdvanceCheck {
  const sec = currentSection(state);
  if (!sec || state.ended) return { advance: false };
  const ex = state.exercises[sec.key];
  const exerciseOpenNotSubmitted = !!sec.exercise && sec.exercise !== "practical_fit" && !!ex && !ex.submittedAt;
  const practicalFitPending = sec.exercise === "practical_fit" && (!ex || !ex.submittedAt);
  // Time budget: allow one minute of grace for exercise sections.
  const budget = sec.minutes * 60 + (sec.exercise ? 60 : 0);
  if (sectionElapsedSec(sec, now) >= budget) return { advance: true, reason: "time" };
  if (sec.askedQ >= sec.maxQ && !exerciseOpenNotSubmitted && !practicalFitPending) return { advance: true, reason: "max_questions" };
  if (opts.agentRequested) {
    if (sec.askedQ < sec.minQ) return { advance: false, blocked: `Ask at least ${sec.minQ} question(s) in this section first (asked ${sec.askedQ}).` };
    if (exerciseOpenNotSubmitted) return { advance: false, blocked: "The candidate has not submitted the exercise yet. Continue the discussion or wait." };
    if (practicalFitPending) return { advance: false, blocked: "The candidate has not confirmed the practical details form yet." };
    return { advance: true, reason: "agent" };
  }
  return { advance: false };
}

/** Close the current section and open the next one (or start wrap-up / end). */
export function advanceSection(state: SessionState, now: Date): SessionState {
  const s = clone(state);
  const sec = s.sections[s.current];
  if (sec) {
    sec.status = "done";
    sec.endedAt = now.toISOString();
  }
  s.followUps = 0;
  if (s.current + 1 >= s.sections.length) {
    s.ended = true;
    return s;
  }
  s.current += 1;
  const next = s.sections[s.current];
  next.status = "active";
  next.startedAt = now.toISOString();
  if (next.key === "wrapup") s.wrapping = true;
  return s;
}

/** Jump straight to the wrap-up section (round time nearly over). */
export function jumpToWrapUp(state: SessionState, now: Date): SessionState {
  let s = clone(state);
  const wrapIdx = s.sections.findIndex((x) => x.key === "wrapup");
  if (wrapIdx === -1 || s.current >= wrapIdx) {
    s.wrapping = true;
    return s;
  }
  for (let i = s.current; i < wrapIdx; i++) {
    const sec = s.sections[i];
    sec.status = "done";
    sec.endedAt = sec.endedAt ?? now.toISOString();
  }
  s.current = wrapIdx;
  s.sections[wrapIdx].status = "active";
  s.sections[wrapIdx].startedAt = now.toISOString();
  s.wrapping = true;
  s.followUps = 0;
  return s;
}

/** Called after each AI message is sent in the current section. */
export function recordAiTurn(state: SessionState): SessionState {
  const s = clone(state);
  const sec = s.sections[s.current];
  if (sec) sec.askedQ += 1;
  return s;
}

export interface AssessmentInput {
  parameter: string;
  score: number;
  needsFollowUp: boolean;
}

/** Apply a hidden micro-evaluation; returns new state and whether the agent should move on (E-4). */
export function applyAssessment(state: SessionState, a: AssessmentInput): { state: SessionState; moveOn: boolean } {
  const s = clone(state);
  const cov = s.coverage[a.parameter] ?? (s.coverage[a.parameter] = { asked: 0, struggled: false });
  cov.asked += 1;
  cov.best = Math.max(cov.best ?? 0, a.score);
  let moveOn = false;
  if (a.needsFollowUp && a.score <= 2) {
    s.followUps += 1;
    if (s.followUps > LIMITS.maxFollowUps) {
      cov.struggled = true;
      s.followUps = 0;
      moveOn = true;
    }
  } else {
    s.followUps = 0;
  }
  return { state: s, moveOn };
}

export function canFollowUp(state: SessionState): boolean {
  return state.followUps < LIMITS.maxFollowUps;
}

export function uncoveredParameters(state: SessionState, weights: Record<string, number>): string[] {
  return Object.entries(weights)
    .filter(([id, w]) => w > 0 && (state.coverage[id]?.asked ?? 0) === 0)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
}

export function startPause(state: SessionState, now: Date): { state: SessionState; error?: string } {
  if (state.pause.pausedAt) return { state, error: "Already paused" };
  if (state.pause.count >= LIMITS.maxPauses) return { state, error: "No pauses left in this round" };
  const s = clone(state);
  s.pause.count += 1;
  s.pause.pausedAt = now.toISOString();
  return { state: s };
}

/** End a pause; returns the number of seconds to extend the deadline and section clock by. */
export function endPause(state: SessionState, now: Date): { state: SessionState; pausedSec: number } {
  if (!state.pause.pausedAt) return { state, pausedSec: 0 };
  const s = clone(state);
  const pausedSec = Math.min(LIMITS.maxPauseSec, Math.max(0, (now.getTime() - Date.parse(s.pause.pausedAt!)) / 1000));
  s.pause.usedSec += pausedSec;
  delete s.pause.pausedAt;
  const sec = s.sections[s.current];
  if (sec?.startedAt) sec.startedAt = new Date(Date.parse(sec.startedAt) + pausedSec * 1000).toISOString();
  return { state: s, pausedSec };
}

export function useSkip(state: SessionState): { state: SessionState; error?: string } {
  if (state.skipsUsed >= LIMITS.maxSkips) return { state, error: "No skips left in this round" };
  const s = clone(state);
  s.skipsUsed += 1;
  s.followUps = 0;
  return { state: s };
}

export function openExercise(state: SessionState, kind: ExerciseKind, refId: string, now: Date): SessionState {
  const s = clone(state);
  const sec = s.sections[s.current];
  if (!sec) return s;
  if (!s.exercises[sec.key]) {
    s.exercises[sec.key] = { sectionKey: sec.key, kind, refId, openedAt: now.toISOString(), hintsUsed: 0, maxHintLevel: 0 };
    s.usedRefs.push(refId);
  }
  return s;
}

export function submitExercise(state: SessionState, sectionKey: string, now: Date): SessionState {
  const s = clone(state);
  const ex = s.exercises[sectionKey];
  if (ex && !ex.submittedAt) ex.submittedAt = now.toISOString();
  return s;
}

export function useHint(state: SessionState, level: number): { state: SessionState; error?: string } {
  const sec = currentSection(state);
  const ex = sec ? state.exercises[sec.key] : undefined;
  if (!ex || ex.kind !== "coding") return { state, error: "Hints are only available during live coding" };
  if (level > 3 || level < 1) return { state, error: "Hint level must be 1–3" };
  const s = clone(state);
  const e = s.exercises[sec!.key];
  e.hintsUsed += 1;
  e.maxHintLevel = Math.max(e.maxHintLevel, level);
  s.hintRequested = false;
  return { state: s };
}
