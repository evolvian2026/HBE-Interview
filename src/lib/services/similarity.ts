/**
 * Copied-code detection: fingerprint each candidate's final coding submission, compare it with other candidates'
 * submissions for the same problem and language in the organisation and with known published solutions, and keep
 * the close matches for a person to review. Matches are context for people only — they never change a score.
 */
import { and, desc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { HttpError, hasRole, type StaffUser } from "../auth/staff";
import { audit } from "../audit";
import { enqueue } from "../jobs/queue";
import { getSettings, saveSettings } from "../settings";
import { getProblem } from "./problems";
import { PROBLEMS, STARTER_CODE } from "../content";
import { SIM, compareFingerprints, fingerprintCode, leakStatus, matchLevel, type Fingerprint, type LeakStatus } from "../core/similarity";
import type { Language } from "../core/types";
import type { SessionState } from "../core/interview";

const LANGS: Language[] = ["python", "javascript", "java", "cpp"];
const isLang = (l: string): l is Language => (LANGS as string[]).includes(l);
const starterCache = new Map<Language, Set<number>>();
function starterHashes(l: Language) {
  if (!starterCache.has(l)) starterCache.set(l, new Set(fingerprintCode(STARTER_CODE[l], l).map((f) => f[0])));
  return starterCache.get(l)!;
}
const fp = (code: string, l: Language) => fingerprintCode(code, l, starterHashes(l));
const AUTHOR_SOURCE = "Problem author's reference solution";

/* ------------------------------ Fingerprinting ----------------------------- */

/** After a round ends: fingerprint the final code for each coding problem and look for close matches. */
export async function fingerprintSessionJob(payload: { sessionId: string }) {
  const [row] = await db
    .select({ s: schema.roundSessions, c: schema.candidacies })
    .from(schema.roundSessions)
    .innerJoin(schema.candidacies, eq(schema.roundSessions.candidacyId, schema.candidacies.id))
    .where(eq(schema.roundSessions.id, payload.sessionId));
  if (!row || row.s.roundIndex < 0) return;
  const problems = Object.values((row.s.state as SessionState).exercises ?? {}).filter((e) => e.kind === "coding").map((e) => e.refId);
  for (const problemId of problems) {
    // The final submission, or the last code they ran if they never submitted.
    const [run] = await db
      .select()
      .from(schema.codeRuns)
      .where(and(eq(schema.codeRuns.sessionId, row.s.id), eq(schema.codeRuns.problemId, problemId), inArray(schema.codeRuns.kind, ["submit", "run", "snapshot"])))
      .orderBy(sql`case ${schema.codeRuns.kind} when 'submit' then 0 when 'run' then 1 else 2 end`, desc(schema.codeRuns.createdAt))
      .limit(1);
    if (!run || !isLang(run.language)) continue;
    const hashes = fp(run.code, run.language);
    if (hashes.length < SIM.minFingerprints) continue;
    const [saved] = await db
      .insert(schema.codeFingerprints)
      .values({ orgId: row.c.orgId, sessionId: row.s.id, candidacyId: row.c.id, driveId: row.c.driveId, problemId, language: run.language, codeRunId: run.id, hashes })
      .onConflictDoUpdate({ target: [schema.codeFingerprints.sessionId, schema.codeFingerprints.problemId], set: { hashes, language: run.language, codeRunId: run.id } })
      .returning();
    await ensureAuthorReference(row.c.orgId, problemId);
    await compareOne(saved);
  }
}

/** Custom problems carry the author's reference solution: a copy of it is a strong leak signal. */
async function ensureAuthorReference(orgId: string, problemId: string) {
  if (!problemId.startsWith("custom-")) return;
  const [p] = await db.select({ code: schema.codingProblems.referenceCode, language: schema.codingProblems.referenceLanguage }).from(schema.codingProblems).where(eq(schema.codingProblems.id, problemId));
  if (!p?.code || !isLang(p.language)) return;
  const [exists] = await db
    .select({ id: schema.codeReferences.id })
    .from(schema.codeReferences)
    .where(and(eq(schema.codeReferences.orgId, orgId), eq(schema.codeReferences.problemId, problemId), eq(schema.codeReferences.source, AUTHOR_SOURCE)));
  if (!exists) await db.insert(schema.codeReferences).values({ orgId, problemId, language: p.language, source: AUTHOR_SOURCE, code: p.code, hashes: fp(p.code, p.language) });
}

type FpRow = typeof schema.codeFingerprints.$inferSelect;

async function compareOne(me: FpRow) {
  const others = await db
    .select()
    .from(schema.codeFingerprints)
    .where(
      and(
        eq(schema.codeFingerprints.orgId, me.orgId),
        eq(schema.codeFingerprints.problemId, me.problemId),
        eq(schema.codeFingerprints.language, me.language),
        ne(schema.codeFingerprints.id, me.id),
        ne(schema.codeFingerprints.candidacyId, me.candidacyId),
      ),
    )
    .orderBy(desc(schema.codeFingerprints.createdAt))
    .limit(2000);
  let found = 0;
  for (const o of others) {
    const r = compareFingerprints(me.hashes as Fingerprint[], o.hashes as Fingerprint[]);
    const level = matchLevel(r.score);
    if (!level) continue;
    // One row per pair, whichever side was fingerprinted first.
    const [a, b, la, lb] = me.id < o.id ? [me, o, r.linesA, r.linesB] : [o, me, r.linesB, r.linesA];
    const ins = await db.insert(schema.codeMatches).values({ orgId: me.orgId, problemId: me.problemId, aId: a.id, bId: b.id, score: r.score, level, linesA: la, linesB: lb }).onConflictDoNothing().returning({ id: schema.codeMatches.id });
    if (ins.length) found++;
  }
  const refs = await db
    .select()
    .from(schema.codeReferences)
    .where(and(eq(schema.codeReferences.orgId, me.orgId), eq(schema.codeReferences.problemId, me.problemId), eq(schema.codeReferences.language, me.language)));
  for (const ref of refs) found += await matchReference(me, ref);
  if (found) await audit({ type: "system", orgId: me.orgId }, "code.match_found", "candidacy", me.candidacyId, { problemId: me.problemId, matches: found });
  return found;
}

async function matchReference(f: FpRow, ref: typeof schema.codeReferences.$inferSelect) {
  const r = compareFingerprints(f.hashes as Fingerprint[], ref.hashes as Fingerprint[]);
  const level = matchLevel(r.score);
  if (!level) return 0;
  const ins = await db.insert(schema.codeMatches).values({ orgId: f.orgId, problemId: f.problemId, aId: f.id, referenceId: ref.id, score: r.score, level, linesA: r.linesA, linesB: r.linesB }).onConflictDoNothing().returning({ id: schema.codeMatches.id });
  return ins.length;
}

/** Fingerprint past rounds that ended before this feature existed (admins). */
export async function scanPast(user: StaffUser) {
  const rows = await db
    .selectDistinct({ id: schema.roundSessions.id })
    .from(schema.roundSessions)
    .innerJoin(schema.candidacies, eq(schema.roundSessions.candidacyId, schema.candidacies.id))
    .innerJoin(schema.codeRuns, eq(schema.codeRuns.sessionId, schema.roundSessions.id))
    .leftJoin(schema.codeFingerprints, eq(schema.codeFingerprints.sessionId, schema.roundSessions.id))
    .where(and(eq(schema.candidacies.orgId, user.orgId), eq(schema.roundSessions.status, "ended"), isNull(schema.codeFingerprints.id)))
    .limit(500);
  for (const r of rows) await enqueue("code-fingerprint", { sessionId: r.id }, { singletonKey: `fingerprint:${r.id}` });
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "code.scan", "organization", user.orgId, { sessions: rows.length });
  return { queued: rows.length };
}

/* ------------------------------ Known solutions ----------------------------- */

export async function addReference(user: StaffUser, input: { problemId: string; language: string; source: string; code: string }) {
  if (!isLang(input.language)) throw new HttpError(400, "Choose one of the supported languages.");
  const problem = await getProblem(input.problemId);
  if (!problem) throw new HttpError(404, "Problem not found");
  if (input.problemId.startsWith("custom-")) {
    const [own] = await db.select({ id: schema.codingProblems.id }).from(schema.codingProblems).innerJoin(schema.drives, eq(schema.codingProblems.driveId, schema.drives.id)).where(and(eq(schema.codingProblems.id, input.problemId), eq(schema.drives.orgId, user.orgId)));
    if (!own) throw new HttpError(404, "Problem not found");
  }
  const hashes = fp(input.code, input.language);
  if (hashes.length < SIM.minFingerprints) throw new HttpError(400, "That code is too short to compare — paste the whole solution.");
  const [ref] = await db.insert(schema.codeReferences).values({ orgId: user.orgId, problemId: input.problemId, language: input.language, source: input.source.trim(), code: input.code, hashes, createdBy: user.id }).returning();
  const subs = await db
    .select()
    .from(schema.codeFingerprints)
    .where(and(eq(schema.codeFingerprints.orgId, user.orgId), eq(schema.codeFingerprints.problemId, input.problemId), eq(schema.codeFingerprints.language, input.language)));
  let found = 0;
  for (const s of subs) found += await matchReference(s, ref);
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "code.reference_add", "code_reference", ref.id, { problemId: input.problemId, language: input.language, matches: found });
  return { id: ref.id, matches: found, checked: subs.length };
}

export async function deleteReference(user: StaffUser, id: string) {
  const [r] = await db.delete(schema.codeReferences).where(and(eq(schema.codeReferences.id, id), eq(schema.codeReferences.orgId, user.orgId))).returning({ id: schema.codeReferences.id });
  if (!r) throw new HttpError(404, "Not found");
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "code.reference_delete", "code_reference", id);
}

/* --------------------------------- Review --------------------------------- */

export async function reviewMatch(user: StaffUser, id: string, input: { status: "open" | "coincidence" | "copied"; note?: string }) {
  const [m] = await db.select().from(schema.codeMatches).where(and(eq(schema.codeMatches.id, id), eq(schema.codeMatches.orgId, user.orgId)));
  if (!m) throw new HttpError(404, "Match not found");
  if (input.status === "copied" && !input.note?.trim()) throw new HttpError(400, "Add a note saying what you saw — it's kept with the decision.");
  await db
    .update(schema.codeMatches)
    .set({ status: input.status, reviewNote: input.note?.trim() || null, reviewedBy: input.status === "open" ? null : user.id, reviewedAt: input.status === "open" ? null : new Date() })
    .where(eq(schema.codeMatches.id, id));
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "code.match_review", "code_match", id, { status: input.status });
}

const sideCols = {
  fpId: schema.codeFingerprints.id,
  candidacyId: schema.codeFingerprints.candidacyId,
  driveId: schema.codeFingerprints.driveId,
  language: schema.codeFingerprints.language,
  codeRunId: schema.codeFingerprints.codeRunId,
  createdAt: schema.codeFingerprints.createdAt,
  name: schema.candidates.name,
  driveTitle: schema.drives.title,
};

async function sides(ids: string[]) {
  if (!ids.length) return new Map<string, Awaited<ReturnType<typeof sideRows>>[number]>();
  const rows = await sideRows(ids);
  return new Map(rows.map((r) => [r.fpId, r]));
}
function sideRows(ids: string[]) {
  return db
    .select(sideCols)
    .from(schema.codeFingerprints)
    .innerJoin(schema.candidacies, eq(schema.codeFingerprints.candidacyId, schema.candidacies.id))
    .innerJoin(schema.candidates, eq(schema.candidacies.candidateId, schema.candidates.id))
    .innerJoin(schema.drives, eq(schema.codeFingerprints.driveId, schema.drives.id))
    .where(inArray(schema.codeFingerprints.id, ids));
}

/** Matches involving one candidacy (for the badge on their report). */
export async function matchesForCandidacy(orgId: string, candidacyId: string) {
  const mine = await db.select({ id: schema.codeFingerprints.id }).from(schema.codeFingerprints).where(and(eq(schema.codeFingerprints.orgId, orgId), eq(schema.codeFingerprints.candidacyId, candidacyId)));
  if (!mine.length) return [];
  const ids = mine.map((m) => m.id);
  return db
    .select({ id: schema.codeMatches.id, score: schema.codeMatches.score, level: schema.codeMatches.level, status: schema.codeMatches.status, reference: sql<boolean>`${schema.codeMatches.referenceId} is not null` })
    .from(schema.codeMatches)
    .where(and(eq(schema.codeMatches.orgId, orgId), or(inArray(schema.codeMatches.aId, ids), inArray(schema.codeMatches.bId, ids))))
    .orderBy(desc(schema.codeMatches.score));
}

/** Both sides of a match, with code, for side-by-side review (recruiters and admins). */
export async function matchDetail(user: StaffUser, id: string) {
  if (!hasRole(user, "recruiter")) throw new HttpError(403, "Recruiters and admins review code matches.");
  const [m] = await db.select().from(schema.codeMatches).where(and(eq(schema.codeMatches.id, id), eq(schema.codeMatches.orgId, user.orgId)));
  if (!m) throw new HttpError(404, "Match not found");
  const s = await sides([m.aId, ...(m.bId ? [m.bId] : [])]);
  const runIds = [...s.values()].map((x) => x.codeRunId).filter((x): x is string => !!x);
  const runs = runIds.length ? await db.select({ id: schema.codeRuns.id, code: schema.codeRuns.code }).from(schema.codeRuns).where(inArray(schema.codeRuns.id, runIds)) : [];
  const code = (fpId: string | null) => (fpId ? (runs.find((r) => r.id === s.get(fpId)?.codeRunId)?.code ?? "") : "");
  const [ref] = m.referenceId ? await db.select().from(schema.codeReferences).where(eq(schema.codeReferences.id, m.referenceId)) : [];
  const problem = await getProblem(m.problemId);
  const [reviewer] = m.reviewedBy ? await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, m.reviewedBy)) : [];
  const a = s.get(m.aId)!;
  const b = m.bId ? s.get(m.bId)! : null;
  return {
    match: m,
    problemTitle: problem?.title ?? m.problemId,
    reviewer: reviewer?.name ?? null,
    a: { ...a, code: code(m.aId) },
    b: b ? { kind: "candidate" as const, ...b, code: code(m.bId) } : { kind: "reference" as const, source: ref?.source ?? "Known solution", language: ref?.language ?? a.language, code: ref?.code ?? "", createdAt: ref?.createdAt ?? null },
  };
}

/* -------------------------------- Overview -------------------------------- */

export interface ProblemLeak {
  problemId: string;
  title: string;
  submissions: number;
  status: LeakStatus;
  largestGroup: number;
  referenceCandidates: number;
  references: { id: string; source: string; language: string }[];
  retired: boolean;
}

export async function similarityOverview(user: StaffUser, opts: { status?: "open" | "reviewed" | "all" } = {}) {
  if (!hasRole(user, "recruiter")) throw new HttpError(403, "Recruiters and admins review code matches.");
  const status = opts.status ?? "open";
  const matches = await db
    .select()
    .from(schema.codeMatches)
    .where(and(eq(schema.codeMatches.orgId, user.orgId), status === "open" ? eq(schema.codeMatches.status, "open") : status === "reviewed" ? ne(schema.codeMatches.status, "open") : undefined))
    .orderBy(desc(schema.codeMatches.score), desc(schema.codeMatches.createdAt))
    .limit(200);
  const s = await sides([...new Set(matches.flatMap((m) => [m.aId, ...(m.bId ? [m.bId] : [])]))]);
  const refs = await db.select({ id: schema.codeReferences.id, problemId: schema.codeReferences.problemId, source: schema.codeReferences.source, language: schema.codeReferences.language }).from(schema.codeReferences).where(eq(schema.codeReferences.orgId, user.orgId));
  const since = new Date(Date.now() - 180 * 86_400_000);
  const counts = await db
    .select({ problemId: schema.codeFingerprints.problemId, n: sql<number>`count(*)::int` })
    .from(schema.codeFingerprints)
    .where(and(eq(schema.codeFingerprints.orgId, user.orgId), gte(schema.codeFingerprints.createdAt, since)))
    .groupBy(schema.codeFingerprints.problemId);
  // Leak status considers every high match (reviewed or not) except ones people marked as coincidence.
  const leakRows = await db
    .select({ problemId: schema.codeMatches.problemId, a: schema.codeMatches.aId, b: schema.codeMatches.bId, ref: schema.codeMatches.referenceId })
    .from(schema.codeMatches)
    .where(and(eq(schema.codeMatches.orgId, user.orgId), eq(schema.codeMatches.level, "high"), ne(schema.codeMatches.status, "coincidence")));
  const settings = await getSettings(user.orgId);
  const problemIds = [...new Set([...counts.map((c) => c.problemId), ...refs.map((r) => r.problemId), ...settings.retiredProblems])];
  const problems: ProblemLeak[] = [];
  for (const pid of problemIds) {
    const rows = leakRows.filter((r) => r.problemId === pid);
    const l = leakStatus({ pairs: rows.filter((r) => r.b).map((r) => [r.a, r.b!] as [string, string]), referenceHits: rows.filter((r) => r.ref).map((r) => r.a) });
    problems.push({
      problemId: pid,
      title: (await getProblem(pid))?.title ?? pid,
      submissions: counts.find((c) => c.problemId === pid)?.n ?? 0,
      ...l,
      references: refs.filter((r) => r.problemId === pid).map(({ id, source, language }) => ({ id, source, language })),
      retired: settings.retiredProblems.includes(pid),
    });
  }
  const rank: Record<LeakStatus, number> = { likely_leaked: 0, watch: 1, ok: 2 };
  problems.sort((x, y) => rank[x.status] - rank[y.status] || y.submissions - x.submissions);
  return {
    matches: matches.map((m) => ({ ...m, a: s.get(m.aId) ?? null, b: m.bId ? (s.get(m.bId) ?? null) : null, reference: m.referenceId ? (refs.find((r) => r.id === m.referenceId) ?? null) : null })),
    problems,
    bank: PROBLEMS.map((p) => ({ id: p.id, title: p.title })),
  };
}

export async function openMatchCount(orgId: string) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.codeMatches).where(and(eq(schema.codeMatches.orgId, orgId), eq(schema.codeMatches.status, "open")));
  return n;
}

/** Stop using a problem for new interviews (e.g. its solution is circulating), or bring it back. */
export async function setProblemRetired(user: StaffUser, problemId: string, retired: boolean) {
  if (!(await getProblem(problemId))) throw new HttpError(404, "Problem not found");
  const s = await getSettings(user.orgId);
  const next = retired ? [...new Set([...s.retiredProblems, problemId])] : s.retiredProblems.filter((p) => p !== problemId);
  if (retired && PROBLEMS.every((p) => next.includes(p.id))) throw new HttpError(400, "At least one problem from the bank must stay in use.");
  await saveSettings(user.orgId, { retiredProblems: next });
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, retired ? "code.problem_retire" : "code.problem_restore", "coding_problem", problemId);
}
