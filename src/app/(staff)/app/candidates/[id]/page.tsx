import Link from "next/link";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/lib/db";
import { canSeeDrive, hasRole, isUuid, requireStaffPage } from "@/lib/auth/staff";
import { enabledRounds } from "@/lib/core/rounds";
import { PARAMETERS } from "@/lib/core/rubrics";
import { RECOMMENDATION_LABEL, ROUND_LABEL, type DriveConfig, type ParamScore, type Recommendation, type RoundType } from "@/lib/core/types";
import type { ParsedResume, ResumeAnalysis, RepoInsight } from "@/lib/ai/analyzers";
import type { Compatibility } from "@/lib/core/practical-fit";
import type { Signal } from "@/lib/core/authenticity";
import { Badge, Card, cx } from "@/components/ui";
import { FIT_TONE, REC_TONE, STAGE_LABEL, STAGE_TONE } from "@/components/labels";
import { CandidateActions } from "@/components/staff/candidate-actions";
import { OverrideForm } from "@/components/staff/override-form";
import { NotesForm } from "@/components/staff/notes-form";
import { SharePanel } from "@/components/staff/share-panel";
import { CandidateFeedbackPanel } from "@/components/staff/candidate-feedback-panel";
import { pendingDeletion } from "@/lib/services/data-rights";
import { CodeReplay } from "@/components/staff/code-replay";
import { ReevaluateButton } from "@/components/staff/reevaluate-button";
import { audit } from "@/lib/audit";
import { languageInfo } from "@/lib/core/languages";
import { reviewsForCandidacy } from "@/lib/services/calibration";
import { getAccommodation } from "@/lib/services/accommodations";
import { AccommodationPanel } from "@/components/staff/accommodation-panel";
import { RequestCalibrationButton } from "@/components/staff/request-calibration-button";
import type { SessionState } from "@/lib/core/interview";

export const dynamic = "force-dynamic";

type RoundSpecific = {
  skillsCoverage?: { skill: string; status: string }[];
  claimsVerification?: { claim: string; verdict: string; note: string }[];
  starStories?: { story: string; situation: boolean; task: boolean; action: boolean; result: boolean; personalOwnership: string }[];
  scenarioNotes?: { scenario: string; assessment: string }[];
  exerciseAssessment?: string;
  valuesEvidence?: { value: string; rating: string; note: string }[];
  redFlags?: string[];
  followUpQuestions?: string[];
  focusAreas?: string[];
  coding?: { problem: string; passed: number; total: number; hints: number; language: string } | null;
  integrity?: { concern: string; summary: string; generated?: { ref: string; likelihood: string; reason: string }[] };
  practicalFit?: Compatibility | null;
  disagreement?: boolean;
};

const VERDICT_TONE: Record<string, "green" | "amber" | "red" | "slate"> = { verified: "green", partially: "amber", unverified: "slate", contradicted: "red", demonstrated: "green", partial: "amber", not_demonstrated: "red", not_assessed: "slate", strong: "green", some: "amber", limited: "amber", none: "red" };

export default async function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaffPage();
  const { id } = await params;
  const [row] = await db
    .select({ c: schema.candidacies, cand: schema.candidates, d: schema.drives, v: schema.driveVersions })
    .from(schema.candidacies)
    .innerJoin(schema.candidates, eq(schema.candidacies.candidateId, schema.candidates.id))
    .innerJoin(schema.drives, eq(schema.candidacies.driveId, schema.drives.id))
    .innerJoin(schema.driveVersions, eq(schema.candidacies.driveVersionId, schema.driveVersions.id))
    .where(isUuid(id) ? eq(schema.candidacies.id, id) : sql`false`);
  if (!row || !canSeeDrive(user, row.d)) notFound();
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "report.view", "candidacy", id);
  const config = row.v.config as DriveConfig;
  const rounds = enabledRounds(config);
  const [resume] = await db.select().from(schema.resumes).where(eq(schema.resumes.candidacyId, id));
  const repos = await db.select().from(schema.repositories).where(eq(schema.repositories.candidacyId, id));
  const sessions = await db.select().from(schema.roundSessions).where(eq(schema.roundSessions.candidacyId, id)).orderBy(asc(schema.roundSessions.roundIndex));
  const reports = await db.select().from(schema.roundReports).where(eq(schema.roundReports.candidacyId, id));
  const [combined] = await db.select().from(schema.combinedReports).where(eq(schema.combinedReports.candidacyId, id));
  const [fit] = await db.select().from(schema.practicalFit).where(eq(schema.practicalFit.candidacyId, id));
  const sessionIds = sessions.map((s) => s.id);
  const msgs = sessionIds.length ? await db.select().from(schema.messages).where(inArray(schema.messages.sessionId, sessionIds)).orderBy(asc(schema.messages.seq)) : [];
  const runs = sessionIds.length ? await db.select().from(schema.codeRuns).where(inArray(schema.codeRuns.sessionId, sessionIds)).orderBy(asc(schema.codeRuns.createdAt)) : [];
  const exResp = sessionIds.length ? await db.select().from(schema.exerciseResponses).where(inArray(schema.exerciseResponses.sessionId, sessionIds)) : [];
  const gates = await db.select({ g: schema.gateDecisions, u: schema.users }).from(schema.gateDecisions).leftJoin(schema.users, eq(schema.gateDecisions.decidedBy, schema.users.id)).where(eq(schema.gateDecisions.candidacyId, id)).orderBy(desc(schema.gateDecisions.createdAt));
  const notes = await db.select({ n: schema.candidacyNotes, u: schema.users }).from(schema.candidacyNotes).leftJoin(schema.users, eq(schema.candidacyNotes.userId, schema.users.id)).where(eq(schema.candidacyNotes.candidacyId, id)).orderBy(desc(schema.candidacyNotes.createdAt));
  const reportIds = reports.map((r) => r.id);
  const overrides = reportIds.length
    ? await db.select({ o: schema.scoreOverrides, u: schema.users }).from(schema.scoreOverrides).leftJoin(schema.users, eq(schema.scoreOverrides.userId, schema.users.id)).where(inArray(schema.scoreOverrides.reportId, reportIds)).orderBy(desc(schema.scoreOverrides.createdAt))
    : [];
  const snapshots = sessionIds.length
    ? await db
        .select({ id: schema.proctorSnapshots.id, sessionId: schema.proctorSnapshots.sessionId, flagged: schema.proctorSnapshots.flagged, check: schema.proctorSnapshots.check, createdAt: schema.proctorSnapshots.createdAt })
        .from(schema.proctorSnapshots)
        .where(inArray(schema.proctorSnapshots.sessionId, sessionIds))
        .orderBy(asc(schema.proctorSnapshots.createdAt))
    : [];
  const deletionRequest = await pendingDeletion(id);
  const surveys = await db.select().from(schema.candidateFeedback).where(eq(schema.candidateFeedback.candidacyId, id)).orderBy(asc(schema.candidateFeedback.roundIndex));
  const shareLinks = await db.select().from(schema.shareLinks).where(eq(schema.shareLinks.candidacyId, id)).orderBy(desc(schema.shareLinks.createdAt));
  const profile = resume?.parsed as ParsedResume | null;
  const canDecide = hasRole(user, "hiring_manager");
  const calibration = canDecide ? await reviewsForCandidacy(id) : [];
  // Adjustment requests can hold health information: recruiters and admins only.
  const accommodation = hasRole(user, "recruiter") ? await getAccommodation(id) : null;
  const [decider] = accommodation?.decidedBy ? await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, accommodation.decidedBy)) : [];
  const cd = combined?.data as { executiveSummary?: string; strengths?: string[]; risks?: string[]; focusAreas?: string[]; contradictions?: string[]; reasons?: string[] } | null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={`/app/drives/${row.d.id}`} className="text-sm text-brand-600 hover:underline">
            ← {row.d.title}
          </Link>
          <h1 className="mt-1 flex items-center gap-3 text-xl font-semibold">
            {row.cand.name} <Badge tone={STAGE_TONE[row.c.stage] ?? "slate"}>{STAGE_LABEL[row.c.stage] ?? row.c.stage}</Badge>
          </h1>
          <p className="text-sm text-slate-500">
            {row.cand.email}
            {row.cand.githubUsername && (
              <>
                {" · "}
                <a className="text-brand-600 hover:underline" href={`https://github.com/${row.cand.githubUsername}`} target="_blank" rel="noreferrer">
                  github.com/{row.cand.githubUsername}
                </a>
              </>
            )}{" "}
            · drive version v{row.v.version}
          </p>
        </div>
        <CandidateActions
          candidacyId={id}
          stage={row.c.stage}
          currentRoundIndex={row.c.currentRoundIndex}
          isLastRound={row.c.currentRoundIndex >= rounds.length - 1}
          canDecide={canDecide}
          canRecruit={hasRole(user, "recruiter")}
          isAdmin={user.role === "admin"}
          hasResume={!!resume}
          hasReports={reports.some((r) => r.status === "ready")}
        />
      </div>

      {/* ------------------------ Combined report ------------------------ */}
      {deletionRequest && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          The candidate asked for their data to be deleted on {deletionRequest.createdAt.toLocaleDateString()}. It will be deleted automatically on {deletionRequest.dueAt.toLocaleDateString()} unless an admin declines with a reason.{" "}
          <Link href="/app/data-requests" className="underline">
            Data requests
          </Link>
        </div>
      )}
      <Card title="Combined report">
        {!combined ? (
          <p className="text-sm text-slate-500">Generated automatically after the last round is evaluated. You can also generate a partial report from the actions above.</p>
        ) : combined.status !== "ready" ? (
          <p className="text-sm text-slate-500">{combined.status === "failed" ? `Generation failed: ${combined.error}` : "Generating…"}</p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            <div>
              <p className="text-4xl font-semibold tabular-nums">{combined.finalScore?.toFixed(0) ?? "—"}<span className="text-base text-slate-500">/100</span></p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge tone={REC_TONE[combined.recommendation as Recommendation]}>{RECOMMENDATION_LABEL[combined.recommendation as Recommendation]}</Badge>
                <Badge>confidence: {combined.confidence}</Badge>
                {combined.partial && <Badge tone="amber">partial</Badge>}
              </div>
              <div className="mt-4 space-y-1 text-sm">
                {rounds.map((r, i) => {
                  const rep = reports.find((x) => x.roundIndex === i);
                  return (
                    <a key={r.type} href={`#round-${i}`} className="flex items-center justify-between rounded px-2 py-1 hover:bg-slate-50">
                      <span>{ROUND_LABEL[r.type]}</span>
                      <span className="tabular-nums">
                        {rep?.status === "ready" ? `${rep.roundScore?.toFixed(0)} · ${RECOMMENDATION_LABEL[rep.recommendation as Recommendation]}` : "—"} <span className="text-xs text-slate-500">(w {config.roundWeights[r.type]}%)</span>
                      </span>
                    </a>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-slate-500">AI recommendations are advisory. A human makes the hiring decision.</p>
            </div>
            <div className="space-y-3 text-sm lg:col-span-2">
              <p>{cd?.executiveSummary}</p>
              <List title="Strengths" items={cd?.strengths} />
              <List title="Risks" items={cd?.risks} />
              <List title="Focus areas for the human panel" items={cd?.focusAreas} highlight />
              {!!cd?.contradictions?.length && <List title="Cross-round contradictions" items={cd.contradictions} />}
              {!!cd?.reasons?.length && <List title="Rules applied" items={cd.reasons} />}
            </div>
          </div>
        )}
        {fit?.compatibility != null && <PracticalFit compat={fit.compatibility as Compatibility} data={fit.data as Record<string, unknown>} />}
      </Card>

      {accommodation && (
        <div id="adjustments">
          <AccommodationPanel
            candidacyId={id}
            a={{
              status: accommodation.status,
              extraTimePct: accommodation.extraTimePct,
              extraBreaks: accommodation.extraBreaks,
              details: accommodation.details,
              approvedExtraTimePct: accommodation.approvedExtraTimePct,
              approvedExtraBreaks: accommodation.approvedExtraBreaks,
              decisionNote: accommodation.decisionNote,
              decidedBy: decider?.name ?? null,
              decidedAt: accommodation.decidedAt?.toISOString() ?? null,
              createdAt: accommodation.createdAt.toISOString(),
            }}
          />
        </div>
      )}

      {/* ------------------------------ Rounds ------------------------------ */}
      {rounds.map((r, i) => {
        const session = sessions.find((s) => s.roundIndex === i);
        const rep = reports.find((x) => x.roundIndex === i);
        const rs = (rep?.roundSpecific ?? {}) as RoundSpecific;
        const params = (rep?.params ?? {}) as Record<string, ParamScore>;
        const transcript = msgs.filter((m) => m.sessionId === session?.id);
        const finalSubmit = [...runs].reverse().find((x) => x.sessionId === session?.id && x.kind === "submit");
        const written = exResp.filter((x) => x.sessionId === session?.id);
        return (
          <section key={r.type} id={`round-${i}`}>
            <Card
              title={
                <span className="flex flex-wrap items-center gap-2">
                  Round {i + 1}: {ROUND_LABEL[r.type]}
                  {rep?.status === "ready" && (
                    <>
                      <span className="tabular-nums">{rep.roundScore?.toFixed(0)}/100</span>
                      <Badge tone={REC_TONE[rep.recommendation as Recommendation]}>{RECOMMENDATION_LABEL[rep.recommendation as Recommendation]}</Badge>
                      <Badge>confidence: {rep.confidence}</Badge>
                    </>
                  )}
                  {rep && rep.status !== "ready" && <Badge tone={rep.status === "failed" ? "red" : "amber"}>{rep.status === "failed" ? "evaluation failed" : "evaluating…"}</Badge>}
                  {!session && <Badge>not started</Badge>}
                  {session && session.status !== "ended" && <Badge tone="blue">in progress</Badge>}
                </span>
              }
              actions={
                session && (
                  <span className="flex items-center gap-3 text-xs text-slate-500">
                    {session.mode === "voice" ? "Voice" : "Text"} · {languageInfo(session.language).label} · {session.endReason ? `ended: ${session.endReason.replace("_", " ")}` : ""} {session.startedAt ? `· ${session.startedAt.toLocaleString()}` : ""}
                    {hasRole(user, "recruiter") && (session.state as SessionState).adjust && <Badge tone="blue">adjusted timing</Badge>}
                    {rep && (rep.status === "ready" || rep.status === "failed") && hasRole(user, "recruiter") && <ReevaluateButton reportId={rep.id} />}
                    {rep?.status === "ready" && canDecide && (rep.calibrationRequestedAt ? !calibration.some((c) => c.r.reportId === rep.id) && <Badge>blind review queued</Badge> : <RequestCalibrationButton reportId={rep.id} />)}
                  </span>
                )
              }
            >
              {!rep || rep.status !== "ready" ? (
                <p className="text-sm text-slate-500">{rep?.status === "failed" ? rep.error : session ? "Report will appear here when the evaluation finishes." : "The candidate has not taken this round yet."}</p>
              ) : (
                <div className="space-y-6">
                  {!!(rep.knockouts as { reason: string }[] | null)?.length && (
                    <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{(rep.knockouts as { reason: string }[]).map((k) => k.reason).join(" ")}</div>
                  )}
                  <p className="text-sm">{rep.summary}</p>
                  <div className="grid gap-4 md:grid-cols-2">
                    <List title="Strengths" items={rep.strengths as string[]} />
                    <List title="Concerns" items={rep.concerns as string[]} />
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="py-2 pr-3">Parameter</th>
                          <th className="py-2 pr-3">Weight</th>
                          <th className="py-2 pr-3">Score</th>
                          <th className="py-2">Justification & evidence</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 align-top">
                        {PARAMETERS[r.type]
                          .filter((p) => (r.weights[p.id] ?? 0) > 0)
                          .map((p) => {
                            const ps = params[p.id];
                            return (
                              <tr key={p.id}>
                                <td className="py-3 pr-3 font-medium">{p.label}</td>
                                <td className="py-3 pr-3 text-slate-500">{r.weights[p.id]}%</td>
                                <td className="py-3 pr-3">
                                  <ScoreDots score={ps?.override?.score ?? ps?.score ?? null} />
                                  {ps?.override && <p className="mt-1 text-xs text-amber-700">AI {ps.score ?? "n/a"} → {ps.override.by}: {ps.override.score}</p>}
                                  {canDecide && <OverrideForm reportId={rep.id} parameter={p.id} current={ps?.override?.score ?? ps?.score ?? null} />}
                                </td>
                                <td className="py-3">
                                  <p>{ps?.justification ?? "Not assessed."}</p>
                                  {ps?.override && <p className="mt-1 text-xs text-slate-600">Override reason: {ps.override.reason}</p>}
                                  <ul className="mt-2 space-y-1">
                                    {(ps?.evidence ?? []).map((e, k) => (
                                      <li key={k} className="text-xs text-slate-600">
                                        <a href={e.type === "transcript" ? `#${session?.id}-${e.ref}` : undefined} className="mr-1 rounded bg-slate-100 px-1 font-mono text-[10px] text-slate-700">
                                          {e.ref}
                                        </a>
                                        “{e.quote}”
                                      </li>
                                    ))}
                                  </ul>
                                  {ps && ps.evidence.length < 2 && ps.score != null && <p className="mt-1 text-xs text-amber-700">Limited verifiable evidence — treat with caution.</p>}
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>

                  {/* Round-specific panels */}
                  {r.type === "technical" && (
                    <div className="grid gap-4 md:grid-cols-2">
                      {!!rs.skillsCoverage?.length && (
                        <Panel title="Must-have skills coverage">
                          <ul className="space-y-1 text-sm">
                            {rs.skillsCoverage.map((s) => (
                              <li key={s.skill} className="flex justify-between gap-2">
                                {s.skill} <Badge tone={VERDICT_TONE[s.status] ?? "slate"}>{s.status.replace("_", " ")}</Badge>
                              </li>
                            ))}
                          </ul>
                        </Panel>
                      )}
                      {!!rs.claimsVerification?.length && (
                        <Panel title="Resume claims verification">
                          <ul className="space-y-2 text-sm">
                            {rs.claimsVerification.map((c, k) => (
                              <li key={k}>
                                <Badge tone={VERDICT_TONE[c.verdict] ?? "slate"}>{c.verdict}</Badge> {c.claim}
                                <p className="text-xs text-slate-500">{c.note}</p>
                              </li>
                            ))}
                          </ul>
                        </Panel>
                      )}
                      {rs.coding && (
                        <Panel title={`Live coding: ${rs.coding.problem}`}>
                          <p className="text-sm">
                            Hidden tests <b>{rs.coding.passed}/{rs.coding.total}</b> · {rs.coding.language} · hints used {rs.coding.hints}
                          </p>
                          <CodeReplay
                            frames={runs
                              .filter((x) => x.sessionId === session?.id)
                              .map((x) => ({
                                at: x.createdAt.toISOString(),
                                kind: x.kind,
                                language: x.language,
                                code: x.code,
                                ...(x.kind !== "snapshot" ? { passed: (x.results as { passed?: number } | null)?.passed, total: (x.results as { total?: number } | null)?.total } : {}),
                              }))}
                          />
                          {!finalSubmit && <p className="mt-1 text-xs text-slate-500">No final submission.</p>}
                        </Panel>
                      )}
                    </div>
                  )}
                  {r.type === "managerial" && (
                    <div className="grid gap-4 md:grid-cols-2">
                      {!!rs.starStories?.length && (
                        <Panel title="STAR completeness">
                          <table className="w-full text-xs">
                            <thead className="text-left text-slate-500">
                              <tr>
                                <th>Story</th>
                                <th>S</th>
                                <th>T</th>
                                <th>A</th>
                                <th>R</th>
                                <th>Ownership</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rs.starStories.map((s, k) => (
                                <tr key={k}>
                                  <td className="py-1 pr-2">{s.story}</td>
                                  {[s.situation, s.task, s.action, s.result].map((b, j) => (
                                    <td key={j}>{b ? "✓" : "–"}</td>
                                  ))}
                                  <td>{s.personalOwnership}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </Panel>
                      )}
                      {!!rs.scenarioNotes?.length && (
                        <Panel title="Situational scenarios">
                          <ul className="space-y-2 text-sm">
                            {rs.scenarioNotes.map((s, k) => (
                              <li key={k}>
                                <p className="font-medium">{s.scenario}</p>
                                <p className="text-slate-600">{s.assessment}</p>
                              </li>
                            ))}
                          </ul>
                        </Panel>
                      )}
                    </div>
                  )}
                  {r.type === "hr" && (
                    <div className="grid gap-4 md:grid-cols-2">
                      {!!rs.valuesEvidence?.length && (
                        <Panel title="Company values evidence">
                          <ul className="space-y-2 text-sm">
                            {rs.valuesEvidence.map((v) => (
                              <li key={v.value}>
                                <Badge tone={VERDICT_TONE[v.rating] ?? "slate"}>{v.rating}</Badge> <b>{v.value}</b>
                                <p className="text-xs text-slate-500">{v.note}</p>
                              </li>
                            ))}
                          </ul>
                        </Panel>
                      )}
                      {!!rs.followUpQuestions?.length && <Panel title="Candidate questions to follow up"><List items={rs.followUpQuestions} /></Panel>}
                      {!!rs.redFlags?.length && <Panel title="Items to verify"><List items={rs.redFlags} /></Panel>}
                    </div>
                  )}
                  {written.map((w) => (
                    <Panel key={w.id} title={`Written ${w.kind.replace("_", " ")} response`}>
                      {Object.entries(w.content as Record<string, string>).filter(([, v]) => v?.trim()).length === 0 ? (
                        <p className="text-sm text-slate-500">Not attempted.</p>
                      ) : (
                        <dl className="space-y-2 text-sm">
                          {Object.entries(w.content as Record<string, string>)
                            .filter(([, v]) => v?.trim())
                            .map(([k, v]) => (
                              <div key={k}>
                                <dt className="text-xs font-medium uppercase text-slate-500">{k}</dt>
                                <dd className="whitespace-pre-wrap">{v}</dd>
                              </div>
                            ))}
                        </dl>
                      )}
                      {w.whiteboardPng && ((w.whiteboard as unknown[] | null)?.length ?? 0) > 0 && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`data:image/png;base64,${w.whiteboardPng.toString("base64")}`} alt="Candidate's system design whiteboard" className="mt-2 w-full max-w-3xl rounded border border-slate-200" />
                      )}
                      {rs.exerciseAssessment && <p className="mt-2 rounded bg-slate-50 p-2 text-sm text-slate-700">AI assessment: {rs.exerciseAssessment}</p>}
                    </Panel>
                  ))}
                  <div className="grid gap-4 md:grid-cols-2">
                    <List title="Suggested focus areas for the next interviewer" items={rs.focusAreas} highlight />
                    {rs.integrity && (
                      <Panel title={<span>Integrity signals <Badge tone={rs.integrity.concern === "high" ? "red" : rs.integrity.concern === "medium" ? "amber" : "slate"}>{rs.integrity.concern}</Badge></span>}>
                        <p className="text-sm text-slate-600">{rs.integrity.summary}</p>
                        {!!rs.integrity.generated?.length && (
                          <ul className="mt-2 space-y-1 text-xs text-slate-600">
                            {rs.integrity.generated.map((g) => (
                              <li key={g.ref}>
                                <a href={`#${session?.id}-${g.ref}`} className="mr-1 rounded bg-slate-100 px-1 font-mono text-[10px] text-slate-700">{g.ref}</a>
                                possibly AI-generated / scripted ({g.likelihood}) — {g.reason}
                              </li>
                            ))}
                          </ul>
                        )}
                        <p className="mt-1 text-xs text-slate-500">Context only — not used in scoring.</p>
                        {snapshots.some((x) => x.sessionId === session?.id) && (
                          <details className="mt-2" open={snapshots.some((x) => x.sessionId === session?.id && x.flagged)}>
                            <summary className="cursor-pointer text-xs text-brand-700">
                              Webcam snapshots ({snapshots.filter((x) => x.sessionId === session?.id).length}, {snapshots.filter((x) => x.sessionId === session?.id && x.flagged).length} flagged)
                            </summary>
                            <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                              {snapshots
                                .filter((x) => x.sessionId === session?.id)
                                .sort((p1, p2) => Number(p2.flagged) - Number(p1.flagged))
                                .slice(0, 24)
                                .map((x) => (
                                  <figure key={x.id} className={cx("rounded border p-1", x.flagged ? "border-amber-400" : "border-slate-200")}>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={`/api/proctor/${x.id}`} alt={`Webcam snapshot at ${x.createdAt.toLocaleTimeString()}`} loading="lazy" className="w-full rounded" />
                                    <figcaption className="mt-0.5 text-[10px] text-slate-500">
                                      {x.createdAt.toLocaleTimeString()} · {(x.check as { note?: string } | null)?.note ?? "pending check"}
                                    </figcaption>
                                  </figure>
                                ))}
                            </div>
                          </details>
                        )}
                      </Panel>
                    )}
                  </div>
                  {calibration.filter((c) => c.r.reportId === rep.id).map(({ r: cr, reviewer }) => (
                    <div key={cr.id} className={cx("rounded-lg border p-3 text-sm", cr.disagrees ? "border-amber-300 bg-amber-50" : "border-emerald-200 bg-emerald-50/50")}>
                      <p className="font-medium">
                        {cr.disagrees ? "A blind human review disagreed with the AI" : "A blind human review agreed with the AI"} <span className="font-normal text-slate-600">— {reviewer ?? "former user"}, {cr.createdAt.toLocaleDateString()}{cr.blind ? "" : " (not blind: the reviewer had seen this report)"}</span>
                      </p>
                      <p className="mt-1">
                        Reviewer: <b>{RECOMMENDATION_LABEL[cr.recommendation as Recommendation]}</b> · AI: <b>{RECOMMENDATION_LABEL[cr.ai.recommendation as Recommendation]}</b>
                      </p>
                      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700">
                        {Object.entries(cr.scores).map(([pid, h]) => (
                          <li key={pid}>
                            {PARAMETERS[r.type].find((p) => p.id === pid)?.label ?? pid}: {h} vs AI {cr.ai.scores[pid] ?? "—"}
                          </li>
                        ))}
                      </ul>
                      {cr.notes && <p className="mt-1 text-xs text-slate-600">Reviewer notes: {cr.notes}</p>}
                    </div>
                  ))}
                  {rs.disagreement && <p className="text-xs text-slate-500">Evaluator runs disagreed on at least one parameter; a third run was used and the median taken.</p>}
                </div>
              )}
              {transcript.length > 0 && (
                <details className="mt-6">
                  <summary className="cursor-pointer text-sm font-medium text-brand-700">Full transcript ({transcript.length} messages)</summary>
                  <ol className="mt-3 space-y-2 text-sm">
                    {transcript.map((m) => (
                      <li key={m.id} id={`${session?.id}-M${m.seq}`} className={cx("rounded-lg p-2", m.role === "candidate" ? "bg-brand-50/50" : m.role === "system" ? "bg-amber-50" : "bg-slate-50")}>
                        <span className="mr-2 font-mono text-[10px] text-slate-500">M{m.seq}</span>
                        <span className="mr-2 text-xs font-medium text-slate-500">{m.role === "ai" ? r.personaName + " (AI)" : m.role === "candidate" ? "Candidate" : "Note"} · {m.sectionKey}</span>
                        {(m.meta as { inputMode?: string } | null)?.inputMode === "voice" && <Badge>voice</Badge>}
                        <p className="mt-1 whitespace-pre-wrap">{m.content}</p>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </Card>
          </section>
        );
      })}

      {/* --------------------------- Profile & repos --------------------------- */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Resume analysis">
          {!profile ? (
            <p className="text-sm text-slate-500">No resume yet.</p>
          ) : (
            <div className="space-y-3 text-sm">
              {resume?.ocrUsed && <Badge tone="amber">Transcribed from a scan/photo (OCR) — verify key details</Badge>}
              <p>{profile.summary}</p>
              <p className="text-xs text-slate-500">
                Experience: {profile.totalYears ?? "?"} yrs · leadership {profile.leadershipYears ?? "?"} yrs · {profile.experience.length} roles · {profile.projects.length} projects
              </p>
              {resume?.jdMatch != null && (
                <div>
                  <p className="text-xs font-medium uppercase text-slate-500">JD match — relevance {(resume.jdMatch as ResumeAnalysis["jdMatch"]).relevance}/100, seniority {(resume.jdMatch as ResumeAnalysis["jdMatch"]).seniorityFit}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(resume.jdMatch as ResumeAnalysis["jdMatch"]).skills.map((s) => (
                      <Badge key={s.skill} tone={s.status === "evidenced" ? "green" : s.status === "listed" ? "amber" : "red"}>
                        {s.skill}: {s.status}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              <List title="Claims probed" items={((resume?.claims as ResumeAnalysis["claims"]) ?? []).map((c) => `[${c.round}] ${c.text}`)} />
              {!!(resume?.riskSignals as ResumeAnalysis["riskSignals"] | null)?.length && <List title="Observations (neutral, not scored)" items={(resume!.riskSignals as ResumeAnalysis["riskSignals"]).map((r) => r.detail)} />}
              {resume?.edits != null && <p className="text-xs text-slate-500">Candidate edits: {JSON.stringify(resume.edits)}</p>}
            </div>
          )}
        </Card>
        <Card title="GitHub repositories">
          {repos.length === 0 ? (
            <p className="text-sm text-slate-500">No projects linked.</p>
          ) : (
            <div className="space-y-4">
              {repos.map((rp) => {
                const an = rp.analysis as { overall?: string; signals?: Signal[]; insight?: RepoInsight } | null;
                return (
                  <div key={rp.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <b>{rp.projectName}</b>
                      {rp.url ? (
                        <a href={rp.url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
                          {rp.url.replace(/^https?:\/\/github\.com\//, "")}
                        </a>
                      ) : (
                        <span className="text-slate-500">not public: {rp.notPublicReason}</span>
                      )}
                      <Badge tone={rp.status === "ready" ? "green" : rp.status === "failed" ? "red" : "slate"}>{rp.status}</Badge>
                      {an?.overall && <Badge tone={an.overall === "high" ? "red" : an.overall === "medium" ? "amber" : "slate"}>concern: {an.overall}</Badge>}
                    </div>
                    {rp.error && <p className="mt-1 text-xs text-red-600">{rp.error}</p>}
                    {an?.insight && <p className="mt-2 text-slate-700">{an.insight.summary}</p>}
                    {an?.signals && (
                      <ul className="mt-2 space-y-1 text-xs">
                        {an.signals.map((s) => (
                          <li key={s.id}>
                            <Badge tone={s.concern === "medium" || s.concern === "high" ? "amber" : "slate"}>{s.concern}</Badge> <b>{s.label}:</b> {s.value} — <span className="text-slate-500">{s.explanation}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
              <p className="text-xs text-slate-500">Signals are indicators, never verdicts. Authenticity is scored mainly on how well the candidate explained their own code.</p>
            </div>
          )}
        </Card>
      </div>

      <SharePanel
        candidacyId={id}
        canShare={canDecide}
        links={shareLinks.map((l) => ({ id: l.id, masked: l.masked, hasPasscode: !!l.passcodeHash, expiresAt: l.expiresAt.toISOString(), revoked: !!l.revokedAt, views: l.views }))}
      />

      <CandidateFeedbackPanel
        candidacyId={id}
        canEdit={hasRole(user, "recruiter")}
        canDraft={hasRole(user, "recruiter") && reports.some((r) => r.status === "ready")}
        initial={(row.c.feedbackSummary as { strengths: string[]; growthAreas: string[]; note: string } | null) ?? null}
        releasedAt={row.c.feedbackReleasedAt?.toISOString() ?? null}
        surveys={surveys.map((f) => ({
          round: f.roundIndex != null && rounds[f.roundIndex] ? ROUND_LABEL[rounds[f.roundIndex].type] : "—",
          overall: f.overall,
          fairness: f.fairness,
          clarity: f.clarity,
          technical: f.technical,
          comment: f.comment,
        }))}
      />

      {/* ------------------------ Notes & decision log ------------------------ */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Notes">
          {canDecide && <NotesForm candidacyId={id} />}
          <ul className="mt-3 space-y-2 text-sm">
            {notes.map(({ n, u }) => (
              <li key={n.id} className="rounded-lg bg-slate-50 p-2">
                <p className="whitespace-pre-wrap">{n.text}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {u?.name ?? "—"} · {n.createdAt.toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Decision log">
          <ul className="space-y-2 text-sm">
            {gates.map(({ g, u }) => (
              <li key={g.id}>
                <Badge tone={g.decision === "advance" ? "green" : g.decision === "reject" ? "red" : "amber"}>{g.decision}</Badge> after round {g.fromRoundIndex + 1} · {g.mode === "auto" ? "automatic" : u?.name} · {g.createdAt.toLocaleString()}
                {g.reason && <span className="text-slate-500"> — {g.reason}</span>}
              </li>
            ))}
            {overrides.map(({ o, u }) => (
              <li key={o.id}>
                <Badge tone="amber">override</Badge> {o.parameter}: {o.oldScore ?? "n/a"} → {o.newScore} by {u?.name} · {o.createdAt.toLocaleString()} — <span className="text-slate-500">{o.reason}</span>
              </li>
            ))}
            {gates.length + overrides.length === 0 && <li className="text-slate-500">No decisions yet.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function List({ title, items, highlight }: { title?: string; items?: string[] | null; highlight?: boolean }) {
  if (!items?.length) return null;
  return (
    <div className={cx(highlight && "rounded-lg bg-brand-50/60 p-3")}>
      {title && <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-600">{title}</p>}
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

function Panel({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-600">{title}</p>
      {children}
    </div>
  );
}

function ScoreDots({ score }: { score: number | null }) {
  if (score == null) return <span className="text-xs text-slate-500">n/a</span>;
  return (
    <span className="inline-flex items-center gap-1" aria-label={`${score} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={cx("h-2.5 w-2.5 rounded-full", i <= score ? (score >= 4 ? "bg-emerald-500" : score === 3 ? "bg-amber-400" : "bg-red-500") : "bg-slate-200")} />
      ))}
      <span className="ml-1 text-xs font-medium tabular-nums">{score}/5</span>
    </span>
  );
}

function PracticalFit({ compat, data }: { compat: Compatibility; data: Record<string, unknown> }) {
  return (
    <div className="mt-6 rounded-lg border border-slate-200 p-3">
      <p className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-600">
        Practical fit <Badge tone={FIT_TONE[compat.overall]}>{compat.overall}</Badge> <span className="normal-case text-slate-500">(not scored)</span>
      </p>
      <div className="grid gap-2 text-sm sm:grid-cols-2">
        {compat.fields.map((f) => (
          <p key={f.field}>
            <Badge tone={FIT_TONE[f.status]}>{f.status}</Badge> <b>{f.label}:</b> {f.detail}
          </p>
        ))}
        {!!data.earliestJoiningDate && <p>Earliest joining: {String(data.earliestJoiningDate)}</p>}
        {!!data.otherOffers && <p>Other offers: {String(data.otherOffers)}</p>}
      </div>
    </div>
  );
}
