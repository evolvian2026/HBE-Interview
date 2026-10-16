import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { enabledRounds } from "../core/rounds";
import { PARAMETERS } from "../core/rubrics";
import { effectiveScore, recRank } from "../core/scoring";
import { ROUND_LABEL, type DriveConfig, type ParamScore, type Recommendation, type RoundType } from "../core/types";
import type { SessionState } from "../core/interview";
import type { Compatibility } from "../core/practical-fit";
import { bins10, estimateCost } from "../core/metrics";

export { bins10, estimateCost, PRICES } from "../core/metrics";

function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export async function driveAnalytics(driveId: string) {
  const [drive] = await db.select().from(schema.drives).where(eq(schema.drives.id, driveId));
  if (!drive) return null;
  const [version] = drive.currentVersionId ? await db.select().from(schema.driveVersions).where(eq(schema.driveVersions.id, drive.currentVersionId)) : [];
  const config = (version?.config ?? drive.draft) as DriveConfig;
  const rounds = enabledRounds(config);
  const cands = await db.select().from(schema.candidacies).where(eq(schema.candidacies.driveId, driveId));
  const ids = cands.map((c) => c.id);
  const none = <T,>(): T[] => [];
  const sessions = ids.length ? await db.select().from(schema.roundSessions).where(inArray(schema.roundSessions.candidacyId, ids)) : none<typeof schema.roundSessions.$inferSelect>();
  const reports = ids.length ? await db.select().from(schema.roundReports).where(inArray(schema.roundReports.candidacyId, ids)) : none<typeof schema.roundReports.$inferSelect>();
  const combined = ids.length ? await db.select().from(schema.combinedReports).where(inArray(schema.combinedReports.candidacyId, ids)) : none<typeof schema.combinedReports.$inferSelect>();
  const resumes = ids.length ? await db.select({ candidacyId: schema.resumes.candidacyId, status: schema.resumes.status }).from(schema.resumes).where(inArray(schema.resumes.candidacyId, ids)) : [];
  const fits = ids.length ? await db.select().from(schema.practicalFit).where(inArray(schema.practicalFit.candidacyId, ids)) : none<typeof schema.practicalFit.$inferSelect>();
  const gates = ids.length ? await db.select().from(schema.gateDecisions).where(inArray(schema.gateDecisions.candidacyId, ids)) : none<typeof schema.gateDecisions.$inferSelect>();
  const reportIds = reports.map((r) => r.id);
  const overrides = reportIds.length ? await db.select().from(schema.scoreOverrides).where(inArray(schema.scoreOverrides.reportId, reportIds)) : [];

  const consented = cands.filter((c) => (c.consent as { accepted?: boolean } | null)?.accepted);
  const ready = reports.filter((r) => r.status === "ready");
  const combinedReady = combined.filter((c) => c.status === "ready");
  const completedAll = combinedReady.filter((c) => !c.partial).length;

  // Funnel: how many candidates reached each step.
  const funnel = [
    { label: "Invited / registered", value: cands.length },
    { label: "Gave consent", value: consented.length },
    { label: "Profile confirmed", value: resumes.filter((r) => r.status === "confirmed").length },
    ...rounds.map((r, i) => ({ label: `Finished ${ROUND_LABEL[r.type]}`, value: sessions.filter((s) => s.roundIndex === i && s.status === "ended").length })),
    { label: "Shortlisted", value: cands.filter((c) => c.stage === "shortlisted").length },
  ];

  // Drop-off: incomplete sessions grouped by the section they ended in, plus candidates who never started.
  const dropCounts = new Map<string, number>();
  for (const s of sessions.filter((x) => x.endReason?.startsWith("incomplete") || x.endReason === "terminated_conduct")) {
    const st = s.state as SessionState;
    const sec = st.sections[st.current]?.title ?? "Unknown";
    const key = `${ROUND_LABEL[s.roundType as RoundType]} · ${sec}`;
    dropCounts.set(key, (dropCounts.get(key) ?? 0) + 1);
  }
  const neverStarted = consented.filter((c) => !sessions.some((s) => s.candidacyId === c.id) && ["expired", "onboarding", "ready"].includes(c.stage)).length;
  const dropOff = [...dropCounts.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  if (neverStarted) dropOff.unshift({ label: "Before Round 1 (onboarding)", value: neverStarted });

  // Durations per round (minutes).
  const durations = rounds.map((r, i) => {
    const mins = sessions
      .filter((s) => s.roundIndex === i && s.status === "ended" && s.startedAt && s.endedAt)
      .map((s) => (s.endedAt!.getTime() - s.startedAt!.getTime()) / 60_000);
    return { type: r.type, label: ROUND_LABEL[r.type], median: median(mins), configured: r.durationMin, n: mins.length };
  });

  // Score distributions.
  const finalScores = combinedReady.map((c) => c.finalScore).filter((x): x is number => x != null);
  const roundScores = rounds.map((r, i) => ({
    type: r.type,
    label: ROUND_LABEL[r.type],
    bins: bins10(ready.filter((x) => x.roundIndex === i && x.roundScore != null).map((x) => x.roundScore!)),
    n: ready.filter((x) => x.roundIndex === i).length,
  }));

  // Parameter averages.
  const paramAverages = rounds.map((r, i) => {
    const reps = ready.filter((x) => x.roundIndex === i);
    return {
      type: r.type,
      label: ROUND_LABEL[r.type],
      rows: PARAMETERS[r.type]
        .filter((p) => (r.weights[p.id] ?? 0) > 0)
        .map((p) => {
          const vals = reps.map((x) => effectiveScore((x.params as Record<string, ParamScore>)?.[p.id])).filter((v): v is number => v != null);
          const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
          return { label: p.label, value: avg, display: vals.length ? `${avg.toFixed(1)}/5` : "—", hint: `${vals.length} candidate(s)` };
        }),
    };
  });

  // Practical-fit mismatches by field.
  const fitCounts = new Map<string, number>();
  for (const f of fits) {
    for (const fld of ((f.compatibility as Compatibility | null)?.fields ?? []).filter((x) => x.status === "mismatch")) fitCounts.set(fld.label, (fitCounts.get(fld.label) ?? 0) + 1);
  }
  const fitMismatch = [...fitCounts.entries()].map(([label, value]) => ({ label, value }));

  // Integrity concern levels (worst per candidate).
  const order = ["none", "low", "medium", "high"];
  const worst = new Map<string, number>();
  for (const r of ready) {
    const c = (r.roundSpecific as { integrity?: { concern: string } } | null)?.integrity?.concern ?? "none";
    worst.set(r.candidacyId, Math.max(worst.get(r.candidacyId) ?? 0, order.indexOf(c)));
  }
  const integrity = order.map((lvl, i) => ({ label: lvl[0].toUpperCase() + lvl.slice(1), value: [...worst.values()].filter((v) => v === i).length }));

  // Recruiter–AI agreement.
  const scoredParams = ready.reduce((a, r) => a + Object.values((r.params as Record<string, ParamScore>) ?? {}).filter((p) => p.score != null).length, 0);
  const overriddenParams = new Set(overrides.map((o) => `${o.reportId}:${o.parameter}`)).size;
  const manual = gates.filter((g) => g.mode === "manual");
  let gateAgree = 0;
  for (const g of manual) {
    const rep = ready.find((r) => r.candidacyId === g.candidacyId && r.roundIndex === g.fromRoundIndex);
    if (!rep) continue;
    const aiAdvance = recRank(rep.recommendation as Recommendation) >= recRank(rounds[g.fromRoundIndex]?.gate.threshold ?? "hire");
    if ((g.decision === "advance") === aiAdvance) gateAgree++;
  }

  return {
    drive,
    config,
    kpis: {
      candidates: cands.length,
      consented: consented.length,
      completedAll,
      completionRate: consented.length ? completedAll / consented.length : null,
      avgFinal: finalScores.length ? finalScores.reduce((a, b) => a + b, 0) / finalScores.length : null,
      scoreAgreement: scoredParams ? 1 - overriddenParams / scoredParams : null,
      overriddenParams,
      scoredParams,
      gateAgreement: manual.length ? gateAgree / manual.length : null,
      manualGates: manual.length,
    },
    funnel,
    dropOff,
    durations,
    finalBins: bins10(finalScores),
    roundScores,
    paramAverages,
    fitMismatch,
    integrity,
  };
}

/* ------------------------------ AI usage & cost ----------------------------- */

export async function aiUsage(sinceDays: number | null) {
  const since = sinceDays ? new Date(Date.now() - sinceDays * 86_400_000) : new Date(0);
  const rows = await db
    .select({
      stage: schema.aiCalls.stage,
      model: schema.aiCalls.model,
      calls: sql<number>`count(*)::int`,
      errors: sql<number>`count(${schema.aiCalls.error})::int`,
      input: sql<number>`coalesce(sum(${schema.aiCalls.inputTokens}),0)::bigint`,
      output: sql<number>`coalesce(sum(${schema.aiCalls.outputTokens}),0)::bigint`,
      cacheRead: sql<number>`coalesce(sum(${schema.aiCalls.cacheReadTokens}),0)::bigint`,
      cacheWrite: sql<number>`coalesce(sum(${schema.aiCalls.cacheWriteTokens}),0)::bigint`,
      p50: sql<number>`coalesce(percentile_cont(0.5) within group (order by ${schema.aiCalls.latencyMs}),0)::int`,
    })
    .from(schema.aiCalls)
    .where(gte(schema.aiCalls.createdAt, since))
    .groupBy(schema.aiCalls.stage, schema.aiCalls.model);
  const byStage = rows
    .map((r) => {
      const t = { input: Number(r.input), output: Number(r.output), cacheRead: Number(r.cacheRead), cacheWrite: Number(r.cacheWrite) };
      return { ...r, ...t, cost: estimateCost(r.model, t) };
    })
    .sort((a, b) => b.cost - a.cost);
  const [{ n: roundsEnded }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.roundSessions)
    .where(and(eq(schema.roundSessions.status, "ended"), gte(schema.roundSessions.endedAt, since)));
  const total = byStage.reduce((a, r) => a + r.cost, 0);
  const totalIn = byStage.reduce((a, r) => a + r.input + r.cacheRead + r.cacheWrite, 0);
  return {
    byStage,
    total,
    calls: byStage.reduce((a, r) => a + r.calls, 0),
    errors: byStage.reduce((a, r) => a + r.errors, 0),
    roundsEnded,
    perRound: roundsEnded ? total / roundsEnded : null,
    cacheShare: totalIn ? byStage.reduce((a, r) => a + r.cacheRead, 0) / totalIn : null,
  };
}
