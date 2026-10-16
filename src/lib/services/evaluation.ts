import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { loadMessages, loadSessionContext, type SessionContext } from "../interview/load";
import { evaluateRound, findProtectedDisclosures, scrubPii, synthesizeCombined, type Evaluation, type EvidenceBundle } from "../ai/evaluation";
import { PARAMETERS, paramLabel } from "../core/rubrics";
import { enabledRounds } from "../core/rounds";
import { quoteMatches } from "../core/evidence";
import {
  finalResult,
  hintCap,
  median,
  roundConfidence,
  roundKnockouts,
  roundRecommendation,
  roundScore,
  runsDisagree,
  type KnockoutResult,
  type RoundResult,
} from "../core/scoring";
import { evaluateGate } from "../core/gating";
import { checkCompatibility, type PracticalFitData } from "../core/practical-fit";
import type { SessionState } from "../core/interview";
import type { DriveConfig, EvidenceItem, ParamScore, Recommendation, RoundType } from "../core/types";
import { RECOMMENDATION_LABEL, ROUND_LABEL } from "../core/types";
import { problemById, DESIGN_PROMPTS, DOMAIN_CASES, MGMT_CASES } from "../content";
import type { RepoInsight } from "../ai/analyzers";
import { enqueue } from "../jobs/queue";
import { getSettings } from "../settings";
import { audit } from "../audit";
import { notifyCandidateNextRound } from "./notify";

/* ----------------------------- Evidence bundle ---------------------------- */

interface BundleExtras {
  codeTexts: string[];
  artifactTexts: string[];
  maxHintLevel: number;
  coding: { problem: string; passed: number; total: number; hints: number; language: string } | null;
  integrity: { concern: "none" | "low" | "medium" | "high"; summary: string; counts: Record<string, number> };
  candidateBySeq: Map<number, string>;
}

function integritySummary(events: (typeof schema.integrityEvents.$inferSelect)[]): BundleExtras["integrity"] {
  const counts: Record<string, number> = {};
  let blurMs = 0;
  let bigPastes = 0;
  for (const e of events) {
    counts[e.type] = (counts[e.type] ?? 0) + 1;
    const p = (e.payload ?? {}) as { durationMs?: number; length?: number };
    if (e.type === "blur" && p.durationMs) blurMs += p.durationMs;
    if (e.type === "paste" && (p.length ?? 0) >= 200) bigPastes++;
  }
  const flags = (counts.ai_flag_injection_attempt ?? 0) + (counts.ai_flag_conduct ?? 0);
  let concern: BundleExtras["integrity"]["concern"] = "none";
  const score = (bigPastes >= 3 ? 2 : bigPastes >= 1 ? 1 : 0) + (blurMs > 5 * 60_000 ? 2 : (counts.blur ?? 0) >= 5 ? 1 : 0) + (flags ? 2 : 0);
  if (score >= 4) concern = "high";
  else if (score >= 2) concern = "medium";
  else if (score >= 1) concern = "low";
  const summary = `Tab/window focus lost ${counts.blur ?? 0} time(s) (${Math.round(blurMs / 1000)}s total); ${counts.paste ?? 0} paste event(s), ${bigPastes} of 200+ characters; ${flags} interviewer flag(s)${counts.compliance_block ? `; ${counts.compliance_block} interviewer message(s) blocked by the compliance filter` : ""}.`;
  return { concern, summary, counts: { ...counts, blurSeconds: Math.round(blurMs / 1000), bigPastes } };
}

async function buildBundle(ctx: SessionContext): Promise<{ bundle: EvidenceBundle; extras: BundleExtras }> {
  const round = ctx.round!;
  const sessionId = ctx.session.id;
  const msgs = await loadMessages(sessionId);
  const nameTokens = ctx.candidate.name.split(/\s+/).filter(Boolean);
  const candMsgs = msgs.filter((m) => m.role === "candidate");
  const protectedRefs = await findProtectedDisclosures(
    candMsgs.map((m) => ({ ref: `M${m.seq}`, content: m.content })),
    { sessionId, candidacyId: ctx.candidacy.id },
  ).catch(() => new Set<string>());
  const candidateBySeq = new Map<number, string>();
  const transcript = msgs
    .map((m) => {
      const ref = `M${m.seq}`;
      let content = m.content;
      if (m.role === "candidate") {
        content = protectedRefs.has(ref) ? "[REDACTED: personal information]" : scrubPii(content, nameTokens);
        candidateBySeq.set(m.seq, content);
      }
      const who = m.role === "ai" ? "Interviewer" : m.role === "candidate" ? "Candidate" : "Note";
      const mode = (m.meta as { inputMode?: string } | null)?.inputMode === "voice" ? " (spoken, transcribed)" : "";
      return `[${ref}] ${who}${mode} (${m.sectionKey}): ${content}`;
    })
    .join("\n");

  const assessments = await db.select().from(schema.assessments).where(eq(schema.assessments.sessionId, sessionId));
  const seqById = new Map(msgs.map((m) => [m.id, m.seq]));
  const runs = await db.select().from(schema.codeRuns).where(eq(schema.codeRuns.sessionId, sessionId)).orderBy(asc(schema.codeRuns.createdAt));
  const exResponses = await db.select().from(schema.exerciseResponses).where(eq(schema.exerciseResponses.sessionId, sessionId));
  const events = await db.select().from(schema.integrityEvents).where(eq(schema.integrityEvents.sessionId, sessionId));
  const state = ctx.state;

  const artifactParts: string[] = [];
  const codeTexts: string[] = [];
  const artifactTexts: string[] = [];
  let coding: BundleExtras["coding"] = null;
  let maxHintLevel = 0;
  for (const ex of Object.values(state.exercises)) {
    if (ex.kind === "coding") {
      const p = problemById(ex.refId);
      const submits = runs.filter((r) => r.kind === "submit" && r.problemId === ex.refId);
      const best = submits.sort((a, b) => ((b.results as { passed: number }).passed ?? 0) - ((a.results as { passed: number }).passed ?? 0))[0];
      const sampleRuns = runs.filter((r) => r.kind === "run").length;
      maxHintLevel = Math.max(maxHintLevel, ex.maxHintLevel);
      if (best) {
        const res = best.results as { passed: number; total: number; compileError?: string; auto?: boolean };
        coding = { problem: p?.title ?? ex.refId, passed: res.passed, total: res.total, hints: ex.hintsUsed, language: best.language };
        codeTexts.push(best.code);
        artifactParts.push(
          `### Coding: ${p?.title} (${p?.difficulty})\n${p?.statement}\n\nFinal submission (${best.language})${res.auto ? " — auto-submitted at time-out" : ""}:\n\`\`\`\n${best.code}\n\`\`\`\nHidden tests: ${res.passed}/${res.total} passed${res.compileError ? `; compile error: ${res.compileError.slice(0, 500)}` : ""}. Sample runs before submitting: ${sampleRuns}. Hints used: ${ex.hintsUsed} (max level ${ex.maxHintLevel}).`,
        );
      } else {
        artifactParts.push(`### Coding: ${p?.title}\nThe candidate did not write or submit any code.`);
      }
    } else if (ex.kind !== "practical_fit") {
      const resp = exResponses.find((r) => r.kind === ex.kind);
      const title = ex.kind === "system_design" ? DESIGN_PROMPTS.find((d) => d.id === ex.refId)?.title : [...DOMAIN_CASES, ...MGMT_CASES].find((c) => c.id === ex.refId)?.title;
      const brief = ex.kind === "system_design" ? DESIGN_PROMPTS.find((d) => d.id === ex.refId)?.brief : [...DOMAIN_CASES, ...MGMT_CASES].find((c) => c.id === ex.refId)?.brief;
      const content = Object.entries((resp?.content as Record<string, string>) ?? {})
        .filter(([, v]) => v?.trim())
        .map(([k, v]) => `[${k}] ${scrubPii(v, nameTokens)}`)
        .join("\n");
      artifactTexts.push(content);
      artifactParts.push(`### ${ex.kind === "system_design" ? "System design" : "Written case"}: ${title}\nBrief: ${brief}\nCandidate's written response:\n${content || "(not attempted)"}`);
    }
  }
  if (round.type === "hr") artifactParts.push("Practical details (notice period, location, work model, compensation) were captured separately and are NOT scored.");

  let repoText = "";
  if (round.type === "technical") {
    repoText = ctx.repos
      .map((r) => {
        if (r.status !== "ready") return `- ${r.projectName}: ${r.notPublicReason ? `not public (${r.notPublicReason})` : `not analysed (${r.error ?? r.status})`}`;
        const an = r.analysis as { insight: RepoInsight; signals: { label: string; value: string; concern: string }[]; overall: string };
        return `- ${r.projectName} (${r.url}) — overall repo concern: ${an.overall}\n  Signals: ${an.signals.map((s) => `${s.label}: ${s.value} [${s.concern}]`).join("; ")}\n  Summary: ${an.insight.summary}\n  Tech match: ${an.insight.techMatch.note}`;
      })
      .join("\n");
  }

  const claims = (ctx.analysis?.claims ?? []).filter((c) => c.round === round.type);
  const integrity = integritySummary(events);
  const bundle: EvidenceBundle = {
    roundType: round.type,
    roleProfileText: JSON.stringify({ ...ctx.config.roleProfile, title: ctx.config.title }, null, 1),
    weights: round.weights,
    sectionsText: state.sections.map((s) => `- ${s.title}: ${s.status}, ${s.askedQ} exchange(s)`).join("\n") + `\nEnd reason: ${ctx.session.endReason ?? "completed"}; skips used: ${state.skipsUsed}.`,
    transcriptText: transcript,
    artifactsText: artifactParts.join("\n\n"),
    repoText,
    claimsText: claims.map((c) => `- ${c.text}`).join("\n"),
    priorSummaries: ctx.prior.map((p) => `- ${p.roundType}: ${p.summary}`).join("\n"),
    integrityText: `${integrity.summary} Concern level: ${integrity.concern}.`,
    valuesText: round.type === "hr" ? ctx.settings.values.map((v) => `- ${v.name}: ${v.description}`).join("\n") : "",
    codingRules: coding
      ? `Hint cap: the candidate's maximum hint level was ${maxHintLevel}, so code_quality and problem_solving cannot exceed ${hintCap(maxHintLevel)}.`
      : round.type === "technical"
        ? "No code was submitted; score code_quality from any code discussed or written, or null if none."
        : "",
    microEvals: assessments.map((a) => ({ parameter: a.parameter, score: a.score, evidence: a.evidence, ref: `M${seqById.get(a.messageId ?? "") ?? 0}` })),
    candidateMessages: candMsgs.map((m) => ({ ref: `M${m.seq}`, content: candidateBySeq.get(m.seq) ?? "" })),
  };
  return { bundle, extras: { codeTexts, artifactTexts, maxHintLevel, coding, integrity, candidateBySeq } };
}

/* ------------------------- Evidence verification ------------------------- */

export function verifyEvidence(items: EvidenceItem[], extras: Pick<BundleExtras, "candidateBySeq" | "codeTexts" | "artifactTexts">, hasRepo: boolean): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  for (const e of items) {
    if (!e.quote?.trim()) continue;
    if (e.type === "transcript") {
      const seq = Number(String(e.ref).replace(/^M/i, ""));
      const content = extras.candidateBySeq.get(seq);
      if (content && quoteMatches(e.quote, content, 0.85)) out.push({ ...e, ref: `M${seq}` });
      else {
        // Accept if the quote matches another candidate message (wrong ref only).
        for (const [s, c] of extras.candidateBySeq) {
          if (quoteMatches(e.quote, c, 0.9)) {
            out.push({ ...e, ref: `M${s}` });
            break;
          }
        }
      }
    } else if (e.type === "code") {
      if (extras.codeTexts.some((c) => quoteMatches(e.quote, c, 0.85))) out.push(e);
    } else if (e.type === "artifact") {
      if (extras.artifactTexts.some((c) => quoteMatches(e.quote, c, 0.85))) out.push(e);
    } else if (e.type === "repo" && hasRepo) {
      out.push(e);
    }
  }
  const seen = new Set<string>();
  return out.filter((e) => {
    const k = `${e.ref}|${e.quote.slice(0, 40)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* ----------------------------- Round evaluation ----------------------------- */

function paramsOf(e: Evaluation) {
  return Object.fromEntries(e.parameters.map((p) => [p.id, p.score == null ? null : Math.max(1, Math.min(5, Math.round(p.score)))]));
}

export async function evaluateRoundJob(payload: { sessionId: string }) {
  const ctx = await loadSessionContext(payload.sessionId);
  if (!ctx || !ctx.round) return;
  const round = ctx.round;
  const cctx = { sessionId: ctx.session.id, candidacyId: ctx.candidacy.id };
  const { bundle, extras } = await buildBundle(ctx);
  const hasRepo = ctx.repos.some((r) => r.status === "ready");

  // Multi-pass evaluation: 2 runs in parallel, a 3rd if any parameter differs by more than 1 point.
  const runs: Evaluation[] = await Promise.all([evaluateRound(bundle, cctx), evaluateRound(bundle, cctx)]);
  const disagreement = runsDisagree(paramsOf(runs[0]), paramsOf(runs[1]));
  if (disagreement) runs.push(await evaluateRound(bundle, cctx));

  const weighted = PARAMETERS[round.type].filter((p) => (round.weights[p.id] ?? 0) > 0).map((p) => p.id);
  const params: Record<string, ParamScore> = {};
  const short: string[] = [];
  for (const id of weighted) {
    const perRun = runs.map((r) => r.parameters.find((p) => p.id === id));
    const med = median(perRun.map((p) => (p?.score == null ? null : Math.round(p.score))));
    const closest = perRun.filter(Boolean).sort((a, b) => Math.abs((a!.score ?? 0) - (med ?? 0)) - Math.abs((b!.score ?? 0) - (med ?? 0)))[0];
    const evidence = verifyEvidence(perRun.flatMap((p) => p?.evidence ?? []), extras, hasRepo).slice(0, 5);
    let score = med;
    if (score != null && (id === "code_quality" || id === "problem_solving") && extras.maxHintLevel > 0) score = Math.min(score, Math.floor(hintCap(extras.maxHintLevel)));
    params[id] = {
      score,
      justification: closest?.justification ?? "",
      evidence,
      confidence: closest?.confidence ?? "low",
    };
    if (score != null && evidence.length < 2) short.push(id);
  }
  // Targeted re-run for parameters with too little verifiable evidence.
  if (short.length) {
    const focus = `Provide at least 2 verbatim evidence quotes for these parameters: ${short.join(", ")}. Quotes must be exact candidate words with the correct message id.`;
    const extra = await evaluateRound(bundle, cctx, focus).catch(() => null);
    if (extra) {
      runs.push(extra);
      for (const id of short) {
        const more = extra.parameters.find((p) => p.id === id)?.evidence ?? [];
        params[id].evidence = verifyEvidence([...params[id].evidence, ...more], extras, hasRepo).slice(0, 5);
        if (params[id].evidence.length < 2) params[id].confidence = "low";
      }
    }
  }

  const primary = runs[0];
  const ethicsFailed = round.type === "managerial" && runs.filter((r) => r.ethicsConcern).length >= Math.ceil(runs.length / 2);
  const knockouts = roundKnockouts(round.type, params, ctx.config, { ethicsFailed });
  const score = roundScore(params, round.weights);
  const recommendation = roundRecommendation(score, knockouts, ctx.config);
  const completed = ctx.session.endReason === "completed" || ctx.session.endReason === "time_up";
  const confidence = roundConfidence({ params, weights: round.weights, completed, skips: ctx.state.skipsUsed, disagreement });

  let practicalFit = null;
  if (round.type === "hr" && ctx.practicalFit) {
    const settings = await getSettings();
    practicalFit = checkCompatibility(ctx.practicalFit.data as PracticalFitData, ctx.config.practicalFitBand, { askCompensation: settings.askCompensation });
    await db.update(schema.practicalFit).set({ compatibility: practicalFit }).where(eq(schema.practicalFit.candidacyId, ctx.candidacy.id));
  }

  await db
    .update(schema.roundReports)
    .set({
      status: "ready",
      params,
      roundScore: score,
      recommendation,
      confidence,
      summary: primary.summary,
      strengths: primary.strengths,
      concerns: primary.concerns,
      knockouts,
      roundSpecific: {
        skillsCoverage: primary.skillsCoverage,
        claimsVerification: primary.claimsVerification,
        starStories: primary.starStories,
        scenarioNotes: primary.scenarioNotes,
        exerciseAssessment: primary.exerciseAssessment,
        valuesEvidence: primary.valuesEvidence,
        redFlags: primary.redFlags,
        followUpQuestions: [...new Set([...(ctx.state.followUpQuestions ?? []), ...primary.followUpQuestions])],
        focusAreas: primary.focusAreas,
        coding: extras.coding,
        integrity: extras.integrity,
        practicalFit,
        disagreement,
      },
      runs: runs.map((r) => ({ scores: paramsOf(r), ethicsConcern: r.ethicsConcern })),
      versions: { evaluator: process.env.AI_MOCK === "true" ? "mock" : process.env.AI_MODEL_EVALUATOR ?? "claude-opus-5-5", prompt: "evaluate_round@1" },
      error: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.roundReports.sessionId, ctx.session.id));

  await afterRoundEvaluated(ctx.candidacy.id, ctx.session.roundIndex, recommendation);
}

export async function evaluateRoundFailed(payload: { sessionId: string; error?: string }) {
  await db
    .update(schema.roundReports)
    .set({ status: "failed", error: (payload.error ?? "").slice(0, 2000), updatedAt: new Date() })
    .where(eq(schema.roundReports.sessionId, payload.sessionId));
}

/* --------------------------------- Gating -------------------------------- */

async function candidacyConfig(candidacyId: string) {
  const [row] = await db
    .select({ candidacy: schema.candidacies, version: schema.driveVersions })
    .from(schema.candidacies)
    .innerJoin(schema.driveVersions, eq(schema.candidacies.driveVersionId, schema.driveVersions.id))
    .where(eq(schema.candidacies.id, candidacyId));
  return row ? { candidacy: row.candidacy, config: row.version.config as DriveConfig } : null;
}

async function afterRoundEvaluated(candidacyId: string, roundIndex: number, recommendation: Recommendation) {
  const row = await candidacyConfig(candidacyId);
  if (!row) return;
  const { candidacy, config } = row;
  const rounds = enabledRounds(config);
  const reports = await db.select().from(schema.roundReports).where(eq(schema.roundReports.candidacyId, candidacyId));
  const isLast = roundIndex >= rounds.length - 1;
  if (config.schedulingMode === "single") {
    const allDone = rounds.every((_, i) => reports.some((r) => r.roundIndex === i && r.status === "ready"));
    if (allDone) {
      await db.update(schema.candidacies).set({ stage: "completed", updatedAt: new Date() }).where(eq(schema.candidacies.id, candidacyId));
      await enqueue("combined-report", { candidacyId }, { singletonKey: `combined:${candidacyId}` });
    }
    return;
  }
  if (["rejected", "shortlisted", "on_hold"].includes(candidacy.stage) || candidacy.currentRoundIndex !== roundIndex) return;
  if (isLast) {
    await db.update(schema.candidacies).set({ stage: "completed", updatedAt: new Date() }).where(eq(schema.candidacies.id, candidacyId));
    await enqueue("combined-report", { candidacyId }, { singletonKey: `combined:${candidacyId}` });
    return;
  }
  const outcome = evaluateGate(rounds[roundIndex].gate, recommendation);
  if (outcome === "advance") {
    await advanceCandidacy(candidacyId, roundIndex, { mode: "auto", reason: `Auto-advanced: ${RECOMMENDATION_LABEL[recommendation]}` });
  } else {
    await db.update(schema.candidacies).set({ stage: "gate_pending", updatedAt: new Date() }).where(eq(schema.candidacies.id, candidacyId));
  }
}

export async function advanceCandidacy(candidacyId: string, fromRoundIndex: number, opts: { mode: "auto" | "manual"; userId?: string; reason?: string }) {
  const row = await candidacyConfig(candidacyId);
  if (!row) return;
  const expiry = new Date(Date.now() + row.config.nextRoundExpiryDays * 86_400_000);
  await db
    .update(schema.candidacies)
    .set({ stage: "round_available", currentRoundIndex: fromRoundIndex + 1, roundAvailableUntil: expiry, updatedAt: new Date() })
    .where(eq(schema.candidacies.id, candidacyId));
  await db.insert(schema.gateDecisions).values({ candidacyId, fromRoundIndex, decision: "advance", mode: opts.mode, decidedBy: opts.userId ?? null, reason: opts.reason ?? null });
  await notifyCandidateNextRound(candidacyId).catch((e) => console.error("notify failed", e));
}

export async function decideGate(candidacyId: string, decision: "advance" | "hold" | "reject", userId: string, reason?: string) {
  const row = await candidacyConfig(candidacyId);
  if (!row) throw new Error("Candidacy not found");
  const { candidacy } = row;
  const from = candidacy.currentRoundIndex;
  if (decision === "advance") {
    const rounds = enabledRounds(row.config);
    if (from >= rounds.length - 1) throw new Error("This is the last round — use Shortlist instead");
    await advanceCandidacy(candidacyId, from, { mode: "manual", userId, reason });
  } else {
    await db
      .update(schema.candidacies)
      .set({ stage: decision === "hold" ? "on_hold" : "rejected", updatedAt: new Date() })
      .where(eq(schema.candidacies.id, candidacyId));
    await db.insert(schema.gateDecisions).values({ candidacyId, fromRoundIndex: from, decision, mode: "manual", decidedBy: userId, reason: reason ?? null });
  }
  await audit({ type: "staff", id: userId }, `gate.${decision}`, "candidacy", candidacyId, { fromRoundIndex: from, reason });
}

/* --------------------------- Overrides & combined --------------------------- */

export async function overrideScore(reportId: string, parameter: string, newScore: number, reason: string, user: { id: string; name: string }) {
  const [report] = await db.select().from(schema.roundReports).where(eq(schema.roundReports.id, reportId));
  if (!report || report.status !== "ready") throw new Error("Report not ready");
  const row = await candidacyConfig(report.candidacyId);
  if (!row) throw new Error("Candidacy not found");
  const round = enabledRounds(row.config)[report.roundIndex];
  const params = { ...((report.params as Record<string, ParamScore>) ?? {}) };
  if (!params[parameter]) throw new Error("Unknown parameter");
  const old = params[parameter].override?.score ?? params[parameter].score;
  params[parameter] = { ...params[parameter], override: { score: newScore, reason, by: user.name, at: new Date().toISOString() } };
  const knockouts = roundKnockouts(round.type, params, row.config, {
    ethicsFailed: ((report.knockouts as KnockoutResult[]) ?? []).some((k) => k.id === "ethics") && parameter !== "judgement",
  });
  const score = roundScore(params, round.weights);
  const recommendation = roundRecommendation(score, knockouts, row.config);
  await db.update(schema.roundReports).set({ params, roundScore: score, recommendation, knockouts, updatedAt: new Date() }).where(eq(schema.roundReports.id, reportId));
  await db.insert(schema.scoreOverrides).values({ reportId, parameter, oldScore: old, newScore, reason, userId: user.id });
  await audit({ type: "staff", id: user.id }, "report.override", "round_report", reportId, { parameter, old, newScore, reason });
  await recomputeFinal(report.candidacyId);
}

/** Recompute the combined final score/recommendation (no LLM call) — used after overrides. */
export async function recomputeFinal(candidacyId: string) {
  const [combined] = await db.select().from(schema.combinedReports).where(eq(schema.combinedReports.candidacyId, candidacyId));
  if (!combined) return;
  const { result } = await computeFinal(candidacyId);
  await db
    .update(schema.combinedReports)
    .set({ finalScore: result.finalScore, recommendation: result.recommendation, partial: result.partial, data: { ...(combined.data as object), reasons: result.reasons }, updatedAt: new Date() })
    .where(eq(schema.combinedReports.candidacyId, candidacyId));
}

async function computeFinal(candidacyId: string) {
  const row = (await candidacyConfig(candidacyId))!;
  const rounds = enabledRounds(row.config);
  const reports = await db
    .select()
    .from(schema.roundReports)
    .where(and(eq(schema.roundReports.candidacyId, candidacyId), eq(schema.roundReports.status, "ready")))
    .orderBy(asc(schema.roundReports.roundIndex));
  const results: RoundResult[] = reports.map((r) => ({
    type: r.roundType as RoundType,
    score: r.roundScore,
    recommendation: r.recommendation as Recommendation,
    knockouts: (r.knockouts as KnockoutResult[]) ?? [],
  }));
  const result = finalResult(row.config, results, rounds.map((r) => r.type));
  return { row, reports, result };
}

export async function combinedReportJob(payload: { candidacyId: string }) {
  const { row, reports, result } = await computeFinal(payload.candidacyId);
  const [fit] = await db.select().from(schema.practicalFit).where(eq(schema.practicalFit.candidacyId, payload.candidacyId));
  const roundsText = reports
    .map((r) => {
      const params = (r.params as Record<string, ParamScore>) ?? {};
      const p = Object.entries(params).map(([id, v]) => `${paramLabel(r.roundType as RoundType, id)}: ${v.override?.score ?? v.score ?? "n/a"}/5 — ${v.justification}`);
      return `### ${ROUND_LABEL[r.roundType as RoundType]} — ${r.roundScore ?? "n/a"}/100 (${RECOMMENDATION_LABEL[r.recommendation as Recommendation] ?? r.recommendation}, confidence ${r.confidence})\nSummary: ${r.summary}\nStrengths: ${((r.strengths as string[]) ?? []).join("; ")}\nConcerns: ${((r.concerns as string[]) ?? []).join("; ")}\n${p.join("\n")}\nFocus areas: ${(((r.roundSpecific as { focusAreas?: string[] })?.focusAreas) ?? []).join("; ")}`;
    })
    .join("\n\n");
  const synth = await synthesizeCombined({
    roleText: `${row.config.title} — ${row.config.roleProfile.summary}`,
    roundsText,
    practicalFitText: fit?.compatibility ? JSON.stringify(fit.compatibility) : "",
    ctx: { candidacyId: payload.candidacyId },
  });
  const values = {
    status: "ready" as const,
    finalScore: result.finalScore,
    recommendation: result.recommendation,
    partial: result.partial,
    confidence: reports.some((r) => r.confidence === "low") || result.partial ? "low" : reports.every((r) => r.confidence === "high") ? "high" : "medium",
    data: { ...synth, reasons: result.reasons, practicalFit: fit?.compatibility ?? null },
    error: null,
    updatedAt: new Date(),
  };
  await db
    .insert(schema.combinedReports)
    .values({ candidacyId: payload.candidacyId, ...values })
    .onConflictDoUpdate({ target: schema.combinedReports.candidacyId, set: values });
}

export async function combinedReportFailed(payload: { candidacyId: string; error?: string }) {
  await db
    .insert(schema.combinedReports)
    .values({ candidacyId: payload.candidacyId, status: "failed", error: payload.error?.slice(0, 2000) })
    .onConflictDoUpdate({ target: schema.combinedReports.candidacyId, set: { status: "failed", error: payload.error?.slice(0, 2000), updatedAt: new Date() } });
}

export type { SessionState };
