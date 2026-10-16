import { searchKb } from "../services/kb";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db, pool, schema } from "../db";
import { HttpError } from "../auth/staff";
import { enqueue } from "../jobs/queue";
import {
  advanceSection,
  applyAssessment,
  checkAdvance,
  currentSection,
  endPause,
  initState,
  jumpToWrapUp,
  recordAiTurn,
  startFirstSection,
  startPause,
  submitExercise,
  timeLeftSec,
  useHint,
  useSkip,
  LIMITS,
  type SessionState,
} from "../core/interview";
import { paramIds } from "../core/rubrics";
import { enabledRounds } from "../core/rounds";
import { quoteMatches } from "../core/evidence";
import { scenariosFor } from "../content";
import { getProblem } from "../services/problems";
import { checkCompliance } from "../ai/evaluation";
import { executeTests } from "../exec";
import { loadMessages, loadSessionContext, type SessionContext } from "./load";
import { ensureExerciseOpen, exerciseStateForModel, whiteboardImage, workspaceFor, type Workspace } from "./exercises";
import { dossierBlock, hash, liveStateText, questionPool, roleBlock, type ServerInstruction } from "./dossier";
import { sectionGuide } from "./sections";
import { runInterviewerTurn, type ToolOutcome } from "./agent";
import { SENIORITY_LABEL, type Language } from "../core/types";
import { audit } from "../audit";
import { emitEvent } from "../services/integrations";

export interface PublicState {
  sessionId: string;
  roundType: string;
  status: string;
  mode: "text" | "voice";
  language: string;
  sections: { key: string; title: string; status: string }[];
  current: number;
  timeLeftSec: number;
  serverNow: string;
  paused: boolean;
  pausesLeft: number;
  skipsLeft: number;
  ended: boolean;
}

export type TurnEvent =
  | { type: "ack"; messageId: string; seq: number }
  | { type: "token"; text: string }
  | { type: "workspace"; workspace: Workspace }
  | { type: "state"; state: PublicState }
  | { type: "done"; aiMessageId: string | null; ended: boolean }
  | { type: "error"; message: string; retryable: boolean };

export type TurnKind = "open" | "answer" | "skip" | "hint" | "submitted";

export function publicState(session: { id: string; roundType: string; status: string; mode: string; language?: string; deadlineAt: Date | null }, state: SessionState, now = new Date()): PublicState {
  return {
    sessionId: session.id,
    roundType: session.roundType,
    status: session.status,
    mode: session.mode as "text" | "voice",
    language: session.language ?? "en",
    sections: state.sections.map((s) => ({ key: s.key, title: s.title, status: s.status })),
    current: state.current,
    timeLeftSec: session.status === "active" ? timeLeftSec(session.deadlineAt, now, state) : 0,
    serverNow: now.toISOString(),
    paused: !!state.pause.pausedAt,
    pausesLeft: LIMITS.maxPauses - state.pause.count,
    skipsLeft: LIMITS.maxSkips - state.skipsUsed,
    ended: session.status === "ended",
  };
}

async function withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query("select pg_try_advisory_lock(hashtext($1)) as ok", [sessionId]);
    if (!rows[0].ok) throw new HttpError(409, "A response is already in progress — please wait a moment.");
    try {
      return await fn();
    } finally {
      await client.query("select pg_advisory_unlock(hashtext($1))", [sessionId]);
    }
  } finally {
    client.release();
  }
}

async function saveState(sessionId: string, state: SessionState, extra: Partial<typeof schema.roundSessions.$inferInsert> = {}) {
  await db
    .update(schema.roundSessions)
    .set({ state, updatedAt: new Date(), ...extra })
    .where(eq(schema.roundSessions.id, sessionId));
}

async function nextSeq(sessionId: string): Promise<number> {
  const [r] = await db
    .select({ max: sql<number>`coalesce(max(${schema.messages.seq}), 0)` })
    .from(schema.messages)
    .where(eq(schema.messages.sessionId, sessionId));
  return Number(r.max) + 1;
}

/* --------------------------------- Start --------------------------------- */

/** Create (or return) the session for a round and start its clock. */
export async function startRound(candidacyId: string, roundIndex: number, mode: "text" | "voice", language = "en") {
  const [cand] = await db
    .select({ candidacy: schema.candidacies, version: schema.driveVersions })
    .from(schema.candidacies)
    .innerJoin(schema.driveVersions, eq(schema.candidacies.driveVersionId, schema.driveVersions.id))
    .where(eq(schema.candidacies.id, candidacyId));
  if (!cand) throw new HttpError(404, "Candidacy not found");
  const rounds = enabledRounds(cand.version.config as never);
  const round = rounds[roundIndex];
  if (!round) throw new HttpError(404, "Round not found");
  const [existing] = await db
    .select()
    .from(schema.roundSessions)
    .where(and(eq(schema.roundSessions.candidacyId, candidacyId), eq(schema.roundSessions.roundIndex, roundIndex)));
  if (existing) {
    if (existing.status === "ended") throw new HttpError(409, "This round has already been submitted.");
    return existing;
  }
  if (cand.candidacy.currentRoundIndex !== roundIndex || !["ready", "round_available"].includes(cand.candidacy.stage))
    throw new HttpError(409, "This round is not available yet.");
  if (cand.candidacy.roundAvailableUntil && cand.candidacy.roundAvailableUntil < new Date())
    throw new HttpError(410, "The window to take this round has expired — please contact the recruiter.");
  const allowed = (cand.version.config as { languages?: string[] }).languages ?? ["en"];
  if (!allowed.includes(language)) throw new HttpError(400, "This interview language is not available for this role.");
  const now = new Date();
  let state = startFirstSection(initState(round, paramIds(round.type)), now);
  if (round.type === "managerial") {
    const track = (cand.version.config as { roleProfile: { track: "ic" | "manager" } }).roleProfile.track;
    const pool = scenariosFor(track);
    const ethics = pool.filter((s) => s.ethics);
    const others = pool.filter((s) => !s.ethics).sort(() => Math.random() - 0.5);
    state = { ...state, plan: { scenarios: [...others.slice(0, 2), ethics[Math.floor(Math.random() * ethics.length)]].filter(Boolean).map((s) => s.id) } };
  }
  const deadline = new Date(now.getTime() + round.durationMin * 60_000);
  const [created] = await db
    .insert(schema.roundSessions)
    .values({
      candidacyId,
      roundIndex,
      roundType: round.type,
      status: "active",
      mode,
      language,
      state,
      startedAt: now,
      deadlineAt: deadline,
      lastHeartbeatAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (!created) {
    const [again] = await db
      .select()
      .from(schema.roundSessions)
      .where(and(eq(schema.roundSessions.candidacyId, candidacyId), eq(schema.roundSessions.roundIndex, roundIndex)));
    return again;
  }
  await db.update(schema.candidacies).set({ stage: "in_round", updatedAt: now }).where(eq(schema.candidacies.id, candidacyId));
  await audit({ type: "candidate", id: candidacyId }, "round.start", "round_session", created.id, { roundIndex, type: round.type, mode, language });
  return created;
}

/* ---------------------------------- Turn --------------------------------- */

export async function handleTurn(
  sessionId: string,
  input: { clientMsgId: string; text: string; kind: TurnKind; inputMode?: "text" | "voice" },
  emit: (e: TurnEvent) => void,
): Promise<void> {
  await withSessionLock(sessionId, async () => {
    const ctx = await loadSessionContext(sessionId);
    if (!ctx || !ctx.round) throw new HttpError(404, "Session not found");
    if (ctx.session.status !== "active") throw new HttpError(409, "This round has ended.");

    // Idempotency: a retried message returns the stored reply.
    if (input.clientMsgId) {
      const [dupe] = await db
        .select()
        .from(schema.messages)
        .where(and(eq(schema.messages.sessionId, sessionId), eq(schema.messages.clientMsgId, input.clientMsgId)));
      if (dupe) {
        const [reply] = await db
          .select()
          .from(schema.messages)
          .where(and(eq(schema.messages.sessionId, sessionId), gt(schema.messages.seq, dupe.seq), eq(schema.messages.role, "ai")))
          .orderBy(schema.messages.seq)
          .limit(1);
        emit({ type: "ack", messageId: dupe.id, seq: dupe.seq });
        if (reply) emit({ type: "token", text: reply.content });
        emit({ type: "state", state: publicState(ctx.session, ctx.state) });
        emit({ type: "done", aiMessageId: reply?.id ?? null, ended: false });
        return;
      }
    }

    const now = new Date();
    let state = ctx.state;
    let deadlineAt = ctx.session.deadlineAt;
    if (state.pause.pausedAt) {
      const r = endPause(state, now);
      state = r.state;
      deadlineAt = new Date((deadlineAt?.getTime() ?? now.getTime()) + r.pausedSec * 1000);
    }

    const history = await loadMessages(sessionId);
    if (input.kind === "open" && history.length) {
      emit({ type: "state", state: publicState({ ...ctx.session, deadlineAt }, state) });
      emit({ type: "done", aiMessageId: null, ended: false });
      return;
    }

    // 1) Store the candidate message.
    let lastCandidate: { seq: number; content: string; id: string } | undefined;
    let moveOn = false;
    if (input.kind !== "open") {
      let content = input.text.trim().slice(0, 4000);
      if (input.kind === "skip") {
        const r = useSkip(state);
        state = r.state;
        content = r.error ? content || "[The candidate asked to skip, but has no skips left.]" : "[The candidate chose to skip this question.]";
        moveOn = !r.error;
      } else if (input.kind === "hint") {
        state = { ...state, hintRequested: true };
        content = content || "Could I get a hint, please?";
      } else if (input.kind === "submitted") {
        content = content || "I've submitted my work.";
        // Mark the open exercise as submitted inside the session lock (auto-submits the latest code for coding).
        state = await closeCurrentExercise(ctx, state, now);
      }
      if (!content) throw new HttpError(400, "Message is empty");
      const seq = await nextSeq(sessionId);
      const [m] = await db
        .insert(schema.messages)
        .values({
          sessionId,
          seq,
          role: "candidate",
          sectionKey: currentSection(state)?.key ?? "unknown",
          content,
          clientMsgId: input.clientMsgId || null,
          meta: { kind: input.kind, inputMode: input.inputMode ?? "text" },
        })
        .returning();
      emit({ type: "ack", messageId: m.id, seq });
      lastCandidate = { seq, content, id: m.id };
      history.push(m);
    }

    // 2) Server-side transitions before the model speaks.
    let instruction: ServerInstruction = input.kind === "open" ? "open" : moveOn ? "move_on" : "continue";
    const left = timeLeftSec(deadlineAt, now, state);
    if (input.kind !== "open") {
      if (left <= 0) {
        instruction = "time_up";
      } else if (left <= LIMITS.wrapUpAtSecLeft && !state.wrapping) {
        state = await closeCurrentExercise(ctx, state, now);
        state = jumpToWrapUp(state, now);
        instruction = "section_start";
      } else {
        const check = checkAdvance(state, now);
        if (check.advance) {
          state = await closeCurrentExercise(ctx, state, now);
          state = advanceSection(state, now);
          instruction = state.ended ? "time_up" : "section_start";
        }
      }
      const sec = currentSection(state);
      if (instruction === "continue" && sec?.key === "wrapup" && sec.askedQ >= 2) instruction = "closing";
    }
    let exerciseNote: string | undefined;
    ({ state, note: exerciseNote } = await ensureExerciseOpen(ctx, state, now));
    emit({ type: "workspace", workspace: await workspaceFor({ ...ctx, state }, state) });

    // 3) Run the interviewer with validated tools.
    let endRequested = false;
    let sectionChanged = false;
    const params = paramIds(ctx.round.type);
    const exec = async (name: string, toolInput: Record<string, unknown>): Promise<ToolOutcome> => {
      const t = new Date();
      switch (name) {
        case "record_assessment": {
          const parameter = String(toolInput.parameter);
          const score = Number(toolInput.score);
          const evidence = String(toolInput.evidence ?? "");
          if (!params.includes(parameter) || !(score >= 1 && score <= 5)) return { content: "Invalid parameter or score.", isError: true };
          if (!lastCandidate) return { content: "There is no candidate answer to assess yet.", isError: true };
          if (!quoteMatches(evidence, lastCandidate.content, 0.6))
            return { content: "Evidence must quote the candidate's last answer verbatim. Try again with an exact phrase.", isError: true };
          await db.insert(schema.assessments).values({
            sessionId,
            messageId: lastCandidate.id,
            sectionKey: currentSection(state)?.key ?? "unknown",
            parameter,
            score: Math.round(score),
            evidence,
            needsFollowUp: !!toolInput.needs_follow_up,
            star: (toolInput.star as object | null) ?? null,
          });
          const r = applyAssessment(state, { parameter, score, needsFollowUp: !!toolInput.needs_follow_up });
          state = r.state;
          return { content: r.moveOn ? "Recorded. The candidate has struggled on this topic after follow-ups — move on to a different topic now." : "Recorded." };
        }
        case "advance_section": {
          const check = checkAdvance(state, t, { agentRequested: true });
          if (!check.advance) return { content: check.blocked ?? "Not yet.", isError: true };
          state = advanceSection(state, t);
          sectionChanged = true;
          if (state.ended) return { content: "All sections are complete. Thank the candidate, close the interview, and call end_interview." };
          const opened = await ensureExerciseOpen(ctx, state, t);
          state = opened.state;
          const sec = currentSection(state)!;
          const guide = sectionGuide(ctx.round!.type, sec.key, ctx.settings.askCompensation);
          const pool = questionPool({ ...ctx, state }, state);
          return {
            content: `ok section_key=${sec.key} title="${sec.title}" minutes=${sec.minutes}\nobjective=${guide.objective}\n${opened.note ? `exercise=${opened.note}\n` : ""}first_question=${pool[0] ?? ""}\nBriefly signpost the new section and ask its first question.`,
          };
        }
        case "give_hint": {
          const r = useHint(state, Number(toolInput.level));
          if (r.error) return { content: r.error, isError: true };
          state = r.state;
          return { content: "Hint recorded. Write the hint in your message without giving away the full solution." };
        }
        case "flag_concern": {
          await db.insert(schema.integrityEvents).values({ sessionId, type: `ai_flag_${String(toolInput.type)}`, payload: { note: String(toolInput.note ?? "") } });
          if (toolInput.type === "conduct") endRequested = true;
          return { content: "Noted for the hiring team." };
        }
        case "log_followup_question": {
          state = { ...state, followUpQuestions: [...(state.followUpQuestions ?? []), String(toolInput.question ?? "")] };
          return { content: "Logged. Tell the candidate the HR team will follow up on this." };
        }
        case "end_interview": {
          const sec = currentSection(state);
          if (!(state.wrapping || state.ended || sec?.key === "wrapup" || instruction === "time_up" || endRequested))
            return { content: "You can only end the interview during wrap-up.", isError: true };
          endRequested = true;
          return { content: "The round will end after your closing message." };
        }
        default:
          return { content: `Unknown tool ${name}`, isError: true };
      }
    };

    const pool = questionPool(ctx, state);
    const sec = currentSection(state);
    const exerciseText = await exerciseStateForModel({ ...ctx, state }, state);
    const buffer = ctx.round.type === "hr";
    const board = await whiteboardImage(sessionId, state);
    let passages = "";
    if (ctx.round.type === "hr" && ctx.kbMode === "retrieval" && lastCandidate) {
      const hits = await searchKb(ctx.candidacy.orgId, lastCandidate.content);
      passages = `<policy_passages>\n${hits.length ? hits.map((h) => `[${h.title}]\n${h.content}`).join("\n---\n") : "(no matching passages)"}\n</policy_passages>`;
    }
    let text = await runInterviewerTurn(
      {
        sessionId,
        candidacyId: ctx.candidacy.id,
        round: ctx.round.type,
        persona: ctx.round.personaName,
        companyName: ctx.settings.companyName,
        roleTitle: ctx.config.title,
        seniority: SENIORITY_LABEL[ctx.config.roleProfile.seniority],
        language: ctx.session.language,
        images: board ? [board] : undefined,
        roleBlock: roleBlock({ ...ctx, state }),
        dossierBlock: dossierBlock({ ...ctx, state }),
        history,
        liveState: liveStateText({ ...ctx, session: { ...ctx.session, deadlineAt } }, state, now, instruction, [exerciseNote ? `Exercise just opened: ${exerciseNote}` : "", exerciseText, passages].filter(Boolean).join("\n"), pool),
        mock: {
          sectionKey: sec?.key ?? "",
          sectionParam: sectionGuide(ctx.round.type, sec?.key ?? "", false).param,
          pool,
          instruction,
          lastCandidate,
          canAdvance: !!sec && sec.askedQ + 1 >= sec.minQ,
          exerciseNote,
          hintRequested: state.hintRequested,
        },
      },
      exec,
      (delta) => {
        if (!buffer) emit({ type: "token", text: delta });
      },
    );

    // 4) HR compliance filter (FEATURES §9.6): never send a message that probes a prohibited topic.
    if (buffer) {
      const verdict = await checkCompliance(text, { askCurrentComp: false }, { sessionId, candidacyId: ctx.candidacy.id }).catch(() => ({ violation: false, category: "none", reason: "" }));
      if (verdict.violation) {
        await db.insert(schema.integrityEvents).values({ sessionId, type: "compliance_block", payload: { category: verdict.category, draft: text } });
        const safe = questionPool(ctx, state)[0] ?? "Could you tell me about a time you worked through a difficult challenge with your team?";
        text = `Thank you for sharing. ${safe}`;
      }
      emit({ type: "token", text });
    }

    // 5) Persist the AI message and state.
    const aiSeq = await nextSeq(sessionId);
    const [aiMsg] = await db
      .insert(schema.messages)
      .values({ sessionId, seq: aiSeq, role: "ai", sectionKey: currentSection(state)?.key ?? "unknown", content: text, meta: { instruction, sectionChanged } })
      .returning();
    state = recordAiTurn(state);
    // Mark suggested questions the interviewer actually asked as used (including the new section's pool after an advance).
    const poolAfter = sectionChanged ? questionPool({ ...ctx, state }, state) : [];
    const used = [...new Set([...pool, ...poolAfter])].filter((q) => quoteMatches(q, text, 0.7)).map((q) => `q:${hash(q)}`);
    if (ctx.round.type === "managerial") {
      for (const id of state.plan?.scenarios ?? []) {
        const s = (await import("../content")).SCENARIOS.find((x) => x.id === id);
        if (s && quoteMatches(s.text.slice(0, 80), text, 0.6)) used.push(`scenario:${id}`);
      }
    }
    if (used.length) state = { ...state, usedRefs: [...state.usedRefs, ...used] };
    if (state.hintRequested && input.kind !== "hint") state = { ...state, hintRequested: false };

    const ended = endRequested || state.ended || instruction === "time_up";
    await saveState(sessionId, state, { deadlineAt });
    if (ended) await endSession(sessionId, endRequested ? "completed" : "time_up");
    const [fresh] = await db.select().from(schema.roundSessions).where(eq(schema.roundSessions.id, sessionId));
    emit({ type: "workspace", workspace: await workspaceFor({ ...ctx, state }, state) });
    emit({ type: "state", state: publicState(fresh, fresh.state as SessionState) });
    emit({ type: "done", aiMessageId: aiMsg.id, ended });
  });
}

/** Auto-submit an open exercise when its section closes (e.g. time ran out). */
async function closeCurrentExercise(ctx: SessionContext, state: SessionState, now: Date): Promise<SessionState> {
  const sec = currentSection(state);
  const ex = sec ? state.exercises[sec.key] : undefined;
  if (!sec || !ex || ex.submittedAt) return state;
  if (ex.kind === "coding") await autoSubmitCoding(ctx.session.id, ex.refId);
  return submitExercise(state, sec.key, now);
}

async function autoSubmitCoding(sessionId: string, problemId: string) {
  const [latest] = await db
    .select()
    .from(schema.codeRuns)
    .where(and(eq(schema.codeRuns.sessionId, sessionId), eq(schema.codeRuns.problemId, problemId)))
    .orderBy(desc(schema.codeRuns.createdAt))
    .limit(1);
  if (!latest || latest.kind === "submit") return;
  const p = await getProblem(problemId);
  if (!p) return;
  const results = await executeTests(latest.language as Language, latest.code, p.hidden, { revealIO: false });
  await db.insert(schema.codeRuns).values({ sessionId, problemId, kind: "submit", language: latest.language, code: latest.code, results: { ...results, auto: true } });
}

/* ---------------------------------- End ---------------------------------- */

export async function endSession(sessionId: string, reason: string) {
  const ctx = await loadSessionContext(sessionId);
  if (!ctx || ctx.session.status === "ended") return;
  const now = new Date();
  let state = ctx.state;
  // Auto-submit any open, unsubmitted exercises.
  for (const ex of Object.values(state.exercises)) {
    if (ex.submittedAt) continue;
    if (ex.kind === "coding") await autoSubmitCoding(sessionId, ex.refId);
    state = submitExercise(state, ex.sectionKey, now);
  }
  state = { ...state, ended: true };
  await db
    .update(schema.roundSessions)
    .set({ status: "ended", endReason: reason, endedAt: now, state, updatedAt: now })
    .where(eq(schema.roundSessions.id, sessionId));
  const rounds = enabledRounds(ctx.config);
  const isLast = ctx.session.roundIndex >= rounds.length - 1;
  if (ctx.config.schedulingMode === "single" && !isLast) {
    await db
      .update(schema.candidacies)
      .set({ stage: "round_available", currentRoundIndex: ctx.session.roundIndex + 1, updatedAt: now })
      .where(eq(schema.candidacies.id, ctx.candidacy.id));
  } else {
    await db.update(schema.candidacies).set({ stage: "evaluating", updatedAt: now }).where(eq(schema.candidacies.id, ctx.candidacy.id));
  }
  await db.insert(schema.roundReports).values({ sessionId, candidacyId: ctx.candidacy.id, roundIndex: ctx.session.roundIndex, roundType: ctx.session.roundType }).onConflictDoNothing();
  await enqueue("evaluate-round", { sessionId }, { singletonKey: `evaluate:${sessionId}`, maxAttempts: 5 });
  await audit({ type: "system" }, "round.end", "round_session", sessionId, { reason });
  await emitEvent(ctx.candidacy.orgId, "round.completed", { candidacyId: ctx.candidacy.id, driveId: ctx.candidacy.driveId, roundIndex: ctx.session.roundIndex, roundType: ctx.session.roundType, endReason: reason });
}

/* -------------------------------- Controls -------------------------------- */

export async function controlSession(sessionId: string, action: "pause" | "resume") {
  return withSessionLock(sessionId, async () => {
    const [s] = await db.select().from(schema.roundSessions).where(eq(schema.roundSessions.id, sessionId));
    if (!s || s.status !== "active") throw new HttpError(409, "This round is not active.");
    const now = new Date();
    let state = s.state as SessionState;
    let deadlineAt = s.deadlineAt;
    if (action === "pause") {
      const r = startPause(state, now);
      if (r.error) throw new HttpError(409, r.error);
      state = r.state;
    } else {
      const r = endPause(state, now);
      state = r.state;
      deadlineAt = new Date((deadlineAt?.getTime() ?? now.getTime()) + r.pausedSec * 1000);
    }
    await saveState(sessionId, state, { deadlineAt });
    return publicState({ ...s, deadlineAt }, state, now);
  });
}

export async function heartbeat(sessionId: string) {
  await db.update(schema.roundSessions).set({ lastHeartbeatAt: new Date() }).where(eq(schema.roundSessions.id, sessionId));
}
