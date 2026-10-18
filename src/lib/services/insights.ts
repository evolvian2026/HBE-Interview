import { and, asc, eq, gte, inArray, ne } from "drizzle-orm";
import { db, schema } from "../db";
import { isUuid, type StaffUser } from "../auth/staff";
import { aiVsDecision, days, funnel, median, panelAgreement } from "../core/insights";
import type { Recommendation } from "../core/types";

export interface InsightsFilter {
  days: number;
  driveId?: string;
}

const SOURCE_LABEL: Record<string, string> = { invite: "Invited", csv: "CSV import", open: "Open link", api: "API / ATS", reinvite: "Talent pool", unknown: "Before tracking" };

/** Hiring insights for candidacies started in the period (an invite-date cohort). */
export async function hiringInsights(user: StaffUser, f: InsightsFilter) {
  const since = new Date(Date.now() - f.days * 86_400_000);
  const cands = await db
    .select({ c: schema.candidacies, drive: schema.drives.title })
    .from(schema.candidacies)
    .innerJoin(schema.drives, eq(schema.candidacies.driveId, schema.drives.id))
    .where(and(eq(schema.candidacies.orgId, user.orgId), gte(schema.candidacies.createdAt, since), f.driveId && isUuid(f.driveId) ? eq(schema.candidacies.driveId, f.driveId) : undefined));
  const ids = cands.map((x) => x.c.id);
  const combined = ids.length ? await db.select().from(schema.combinedReports).where(and(inArray(schema.combinedReports.candidacyId, ids), eq(schema.combinedReports.status, "ready"))) : [];
  const decisions = ids.length ? await db.select().from(schema.hiringDecisions).where(inArray(schema.hiringDecisions.candidacyId, ids)).orderBy(asc(schema.hiringDecisions.createdAt)) : [];
  const panels = ids.length ? await db.select().from(schema.panelInterviews).where(and(inArray(schema.panelInterviews.candidacyId, ids), ne(schema.panelInterviews.status, "cancelled"))) : [];
  const cards = panels.length ? await db.select().from(schema.panelScorecards).where(inArray(schema.panelScorecards.interviewId, panels.map((p) => p.id))) : [];

  const byId = new Map(cands.map((x) => [x.c.id, x]));
  const combinedOf = new Map(combined.map((r) => [r.candidacyId, r]));
  // The decision that counts: the latest offer/reject; holds only if nothing else.
  const finalOf = new Map<string, (typeof decisions)[number]>();
  const firstFinalAt = new Map<string, Date>();
  for (const d of decisions) {
    if (d.decision !== "hold") {
      finalOf.set(d.candidacyId, d);
      if (!firstFinalAt.has(d.candidacyId)) firstFinalAt.set(d.candidacyId, d.createdAt);
    }
  }
  const consentAt = (c: typeof schema.candidacies.$inferSelect) => {
    const k = c.consent as { accepted?: boolean; at?: string } | null;
    return k?.accepted && k.at ? new Date(k.at) : null;
  };

  const consented = cands.filter((x) => consentAt(x.c));
  const aiDone = cands.filter((x) => combinedOf.has(x.c.id));
  const inPanel = new Set(panels.map((p) => p.candidacyId));
  const offers = cands.filter((x) => finalOf.get(x.c.id)?.decision === "offer");
  const steps = funnel([
    { label: "Invited / registered", value: cands.length },
    { label: "Gave consent", value: consented.length },
    { label: "Finished the AI rounds", value: aiDone.length },
    { label: "Panel interview", value: cands.filter((x) => inPanel.has(x.c.id)).length },
    { label: "Offer", value: offers.length },
  ]);

  const timing = {
    toConsent: median(consented.map((x) => days(x.c.createdAt, consentAt(x.c)!))),
    toAiDone: median(aiDone.map((x) => days(x.c.createdAt, combinedOf.get(x.c.id)!.createdAt))),
    aiDoneToDecision: median(aiDone.filter((x) => firstFinalAt.has(x.c.id)).map((x) => days(combinedOf.get(x.c.id)!.createdAt, firstFinalAt.get(x.c.id)!))),
    toDecision: median(cands.filter((x) => firstFinalAt.has(x.c.id)).map((x) => days(x.c.createdAt, firstFinalAt.get(x.c.id)!))),
  };

  const sourceMap = new Map<string, { invited: number; aiDone: number; offers: number }>();
  for (const x of cands) {
    const k = x.c.source ?? "unknown";
    const s = sourceMap.get(k) ?? { invited: 0, aiDone: 0, offers: 0 };
    s.invited++;
    if (combinedOf.has(x.c.id)) s.aiDone++;
    if (finalOf.get(x.c.id)?.decision === "offer") s.offers++;
    sourceMap.set(k, s);
  }
  const sources = [...sourceMap.entries()].map(([k, v]) => ({ source: k, label: SOURCE_LABEL[k] ?? k, ...v })).sort((a, b) => b.invited - a.invited);

  const ai = aiVsDecision(
    [...finalOf.values()]
      .filter((d) => combinedOf.get(d.candidacyId)?.recommendation)
      .map((d) => ({ ai: combinedOf.get(d.candidacyId)!.recommendation as Recommendation, decision: d.decision as "offer" | "reject" })),
  );
  const overruled = [...finalOf.values()]
    .filter((d) => {
      const rec = combinedOf.get(d.candidacyId)?.recommendation as Recommendation | undefined;
      return rec && (["strong_hire", "hire"].includes(rec) ? d.decision === "reject" : d.decision === "offer");
    })
    .slice(-10)
    .map((d) => ({ candidacyId: d.candidacyId, drive: byId.get(d.candidacyId)?.drive ?? "", ai: combinedOf.get(d.candidacyId)!.recommendation as Recommendation, decision: d.decision, reason: d.reason, at: d.createdAt }));

  const panel = panelAgreement(
    panels.map((p) => ({ competencies: p.competencies, cards: cards.filter((c) => c.interviewId === p.id && c.submittedAt).map((c) => ({ ratings: c.ratings, recommendation: c.recommendation })) })),
  );

  const driveMap = new Map<string, { drive: string; invited: number; aiDone: number; offers: number; toDecision: number[] }>();
  for (const x of cands) {
    const d = driveMap.get(x.c.driveId) ?? { drive: x.drive, invited: 0, aiDone: 0, offers: 0, toDecision: [] };
    d.invited++;
    if (combinedOf.has(x.c.id)) d.aiDone++;
    if (finalOf.get(x.c.id)?.decision === "offer") d.offers++;
    if (firstFinalAt.has(x.c.id)) d.toDecision.push(days(x.c.createdAt, firstFinalAt.get(x.c.id)!));
    driveMap.set(x.c.driveId, d);
  }
  const drives = [...driveMap.entries()].map(([id, d]) => ({ id, drive: d.drive, invited: d.invited, aiDone: d.aiDone, offers: d.offers, medianDaysToDecision: median(d.toDecision) })).sort((a, b) => b.invited - a.invited);

  const rows = cands.map((x) => {
    const comb = combinedOf.get(x.c.id);
    const fin = finalOf.get(x.c.id);
    return {
      candidacyId: x.c.id,
      drive: x.drive,
      source: x.c.source ?? "unknown",
      stage: x.c.stage,
      invitedAt: x.c.createdAt.toISOString(),
      consentedAt: consentAt(x.c)?.toISOString() ?? "",
      aiCompletedAt: comb?.createdAt.toISOString() ?? "",
      aiRecommendation: comb?.recommendation ?? "",
      aiScore: comb?.finalScore != null ? comb.finalScore.toFixed(0) : "",
      panel: inPanel.has(x.c.id) ? "yes" : "no",
      decision: fin?.decision ?? "",
      decidedAt: firstFinalAt.get(x.c.id)?.toISOString() ?? "",
      daysToDecision: firstFinalAt.has(x.c.id) ? days(x.c.createdAt, firstFinalAt.get(x.c.id)!).toFixed(1) : "",
    };
  });

  return { since, steps, timing, sources, ai, overruled, panel, drives, rows };
}
