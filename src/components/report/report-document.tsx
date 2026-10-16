import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { enabledRounds } from "@/lib/core/rounds";
import { PARAMETERS } from "@/lib/core/rubrics";
import { RECOMMENDATION_LABEL, ROUND_LABEL, SENIORITY_LABEL, type DriveConfig, type ParamScore, type Recommendation } from "@/lib/core/types";
import type { Compatibility } from "@/lib/core/practical-fit";
import { getSettings } from "@/lib/settings";

/**
 * Read-only, print-friendly candidate report used for PDF export (browser "Save as PDF") and share links.
 * `masked` hides the candidate's identity (name, email, GitHub) — the default for shared links.
 */
export async function ReportDocument({ candidacyId, masked, includeTranscript = false }: { candidacyId: string; masked: boolean; includeTranscript?: boolean }) {
  const [row] = await db
    .select({ c: schema.candidacies, cand: schema.candidates, d: schema.drives, v: schema.driveVersions })
    .from(schema.candidacies)
    .innerJoin(schema.candidates, eq(schema.candidacies.candidateId, schema.candidates.id))
    .innerJoin(schema.drives, eq(schema.candidacies.driveId, schema.drives.id))
    .innerJoin(schema.driveVersions, eq(schema.candidacies.driveVersionId, schema.driveVersions.id))
    .where(eq(schema.candidacies.id, candidacyId));
  if (!row) return <p>Report not found.</p>;
  const config = row.v.config as DriveConfig;
  const rounds = enabledRounds(config);
  const settings = await getSettings(row.c.orgId);
  const reports = await db.select().from(schema.roundReports).where(eq(schema.roundReports.candidacyId, candidacyId));
  const [combined] = await db.select().from(schema.combinedReports).where(eq(schema.combinedReports.candidacyId, candidacyId));
  const [fit] = await db.select().from(schema.practicalFit).where(eq(schema.practicalFit.candidacyId, candidacyId));
  const sessions = await db.select().from(schema.roundSessions).where(eq(schema.roundSessions.candidacyId, candidacyId));
  const msgs = includeTranscript && sessions.length
    ? await db.select().from(schema.messages).where(inArray(schema.messages.sessionId, sessions.map((s) => s.id))).orderBy(asc(schema.messages.seq))
    : [];
  const name = masked ? `Candidate ${candidacyId.slice(0, 6).toUpperCase()}` : row.cand.name;
  const cd = combined?.data as { executiveSummary?: string; strengths?: string[]; risks?: string[]; focusAreas?: string[]; reasons?: string[] } | null;
  // In masked mode, replace the candidate's name tokens anywhere in generated text.
  const nameTokens = row.cand.name.split(/\s+/).filter((x) => x.length > 2).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const nameRe = nameTokens.length ? new RegExp(`\\b(${nameTokens.join("|")})\\b`, "gi") : null;
  const scrub = (t: string) => (masked && nameRe ? t.replace(nameRe, "[name]") : t);

  return (
    <article className="mx-auto max-w-4xl bg-white p-8 text-[13px] leading-relaxed text-slate-900 print:p-0">
      <header className="flex items-start justify-between border-b border-slate-300 pb-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">{settings.companyName} · HBE Interview report</p>
          <h1 className="mt-1 text-2xl font-semibold">{name}</h1>
          <p className="text-slate-600">
            {row.d.title} · {SENIORITY_LABEL[config.roleProfile.seniority]} · drive v{row.v.version}
            {!masked && ` · ${row.cand.email}`}
          </p>
        </div>
        <div className="text-right">
          {combined?.status === "ready" ? (
            <>
              <p className="text-3xl font-semibold tabular-nums">{combined.finalScore?.toFixed(0)}<span className="text-base text-slate-400">/100</span></p>
              <p className="font-medium">{RECOMMENDATION_LABEL[combined.recommendation as Recommendation]}{combined.partial ? " (partial)" : ""}</p>
              <p className="text-xs text-slate-500">confidence {combined.confidence}</p>
            </>
          ) : (
            <p className="text-slate-500">Combined report not ready</p>
          )}
        </div>
      </header>

      {cd && (
        <section className="mt-4 space-y-2">
          <p>{scrub(cd.executiveSummary ?? "")}</p>
          <div className="grid grid-cols-2 gap-4">
            <DocList title="Strengths" items={cd.strengths?.map(scrub)} />
            <DocList title="Risks" items={cd.risks?.map(scrub)} />
          </div>
          <DocList title="Focus areas for the human panel" items={cd.focusAreas?.map(scrub)} />
          {!!cd.reasons?.length && <DocList title="Rules applied" items={cd.reasons} />}
        </section>
      )}

      {fit?.compatibility != null && (
        <section className="mt-4 break-inside-avoid">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Practical fit (not scored): {(fit.compatibility as Compatibility).overall}</h2>
          <ul className="mt-1 grid grid-cols-2 gap-x-4">
            {(fit.compatibility as Compatibility).fields.map((f) => (
              <li key={f.field}>
                {f.label}: <b>{f.status}</b> — {f.detail}
              </li>
            ))}
          </ul>
        </section>
      )}

      {rounds.map((r, i) => {
        const rep = reports.find((x) => x.roundIndex === i && x.status === "ready");
        const params = (rep?.params ?? {}) as Record<string, ParamScore>;
        const rs = (rep?.roundSpecific ?? {}) as { focusAreas?: string[]; integrity?: { concern: string; summary: string }; coding?: { problem: string; passed: number; total: number; hints: number } | null };
        return (
          <section key={r.type} className="mt-6 break-inside-avoid-page">
            <h2 className="flex items-baseline justify-between border-b border-slate-200 pb-1 text-base font-semibold">
              <span>
                Round {i + 1}: {ROUND_LABEL[r.type]}
              </span>
              {rep ? (
                <span className="tabular-nums">
                  {rep.roundScore?.toFixed(0)}/100 · {RECOMMENDATION_LABEL[rep.recommendation as Recommendation]} · confidence {rep.confidence}
                </span>
              ) : (
                <span className="text-sm font-normal text-slate-500">not evaluated</span>
              )}
            </h2>
            {rep && (
              <>
                <p className="mt-2">{scrub(rep.summary ?? "")}</p>
                {!!(rep.knockouts as { reason: string }[] | null)?.length && <p className="mt-1 font-medium text-red-700">{(rep.knockouts as { reason: string }[]).map((k) => k.reason).join(" ")}</p>}
                <table className="mt-2 w-full">
                  <thead className="text-left text-xs text-slate-500">
                    <tr>
                      <th className="py-1 pr-2">Parameter</th>
                      <th className="py-1 pr-2">Weight</th>
                      <th className="py-1 pr-2">Score</th>
                      <th className="py-1">Justification and evidence</th>
                    </tr>
                  </thead>
                  <tbody className="align-top">
                    {PARAMETERS[r.type]
                      .filter((p) => (r.weights[p.id] ?? 0) > 0)
                      .map((p) => {
                        const ps = params[p.id];
                        const s = ps?.override?.score ?? ps?.score;
                        return (
                          <tr key={p.id} className="border-t border-slate-100">
                            <td className="py-1.5 pr-2 font-medium">{p.label}</td>
                            <td className="py-1.5 pr-2">{r.weights[p.id]}%</td>
                            <td className="py-1.5 pr-2 tabular-nums">
                              {s ?? "n/a"}/5{ps?.override && <span className="block text-[11px] text-amber-700">overridden (AI {ps.score ?? "n/a"})</span>}
                            </td>
                            <td className="py-1.5">
                              {scrub(ps?.justification ?? "")}
                              {(ps?.evidence ?? []).slice(0, 2).map((e, k) => (
                                <span key={k} className="block text-[11px] text-slate-600">
                                  [{e.ref}] “{scrub(e.quote)}”
                                </span>
                              ))}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
                {rs.coding && (
                  <p className="mt-1 text-slate-700">
                    Live coding — {rs.coding.problem}: {rs.coding.passed}/{rs.coding.total} hidden tests, {rs.coding.hints} hint(s).
                  </p>
                )}
                <DocList title="Focus areas" items={rs.focusAreas?.map(scrub)} />
                {rs.integrity && <p className="mt-1 text-xs text-slate-500">Integrity (context only): {rs.integrity.concern} — {rs.integrity.summary}</p>}
              </>
            )}
            {includeTranscript && (
              <details className="mt-2 print:block" open>
                <summary className="cursor-pointer text-xs text-slate-500 print:hidden">Transcript</summary>
                <ol className="mt-1 space-y-1 text-[11px]">
                  {msgs
                    .filter((m) => sessions.find((s) => s.id === m.sessionId)?.roundIndex === i && m.role !== "system")
                    .map((m) => (
                      <li key={m.id}>
                        <b>{m.role === "ai" ? "Interviewer" : masked ? "Candidate" : row.cand.name.split(" ")[0]}:</b> {scrub(m.content)}
                      </li>
                    ))}
                </ol>
              </details>
            )}
          </section>
        );
      })}
      <footer className="mt-8 border-t border-slate-200 pt-2 text-[11px] text-slate-500">
        AI-generated assessment — advisory only; hiring decisions are made by people. Generated {new Date().toLocaleString()}.
      </footer>
    </article>
  );
}

function DocList({ title, items }: { title: string; items?: string[] | null }) {
  if (!items?.length) return null;
  return (
    <div className="break-inside-avoid">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      <ul className="list-disc pl-5">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}
