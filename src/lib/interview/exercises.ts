import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "../db";
import {
  DESIGN_PROMPTS,
  DESIGN_TEMPLATE,
  DOMAIN_CASES,
  LANGUAGE_LABEL,
  MGMT_CASES,
  STARTER_CODE,
  designPromptFor,
  domainCaseFor,
  mgmtCaseFor,
  prioritizationSetFor,
  PRIORITIZATION_SETS,
  writtenExerciseInfo,
} from "../content";
import { currentSection, openExercise, type ExerciseState, type SessionState } from "../core/interview";
import { emptyPracticalFit, type PracticalFitData } from "../core/practical-fit";
import { getProblem, pickProblemForDrive } from "../services/problems";
import type { ExerciseKind, Language } from "../core/types";
import type { SessionContext } from "./load";
import type { RepoInsight } from "../ai/analyzers";

/** Open the exercise for the current section if it has one and it is not open yet. Returns a note for the model. */
export async function ensureExerciseOpen(ctx: SessionContext, state: SessionState, now: Date): Promise<{ state: SessionState; note?: string }> {
  const sec = currentSection(state);
  if (!sec?.exercise || state.exercises[sec.key]) return { state };
  const profile = ctx.config.roleProfile;
  let refId: string;
  let note: string;
  const kind: ExerciseKind = sec.exercise;
  if (kind === "coding") {
    const p = await pickProblemForDrive(ctx.candidacy.driveId, { difficulty: ctx.config.coding.difficulty, domain: profile.domain, skills: profile.mustHaveSkills, exclude: state.usedRefs });
    refId = p.id;
    note = `Coding problem "${p.title}" (${p.difficulty}) is now open in the candidate's editor.\n${p.statement}`;
  } else if (kind === "system_design") {
    const d = designPromptFor(profile.domain, profile.mustHaveSkills, state.usedRefs);
    refId = d.id;
    note = `System design prompt "${d.title}" is now open in the design panel: ${d.brief}`;
  } else if (kind === "domain_case") {
    const c = domainCaseFor(profile.category, profile.domain, ctx.config.title, state.usedRefs);
    refId = c.id;
    note = `Case "${c.title}" is now open in the case panel: ${c.brief}`;
  } else if (kind === "mgmt_case") {
    const c = mgmtCaseFor(profile.track, profile.seniority, state.usedRefs);
    refId = c.id;
    note = `Written case "${c.title}" is now open in the case panel (about ${c.minutes} minutes): ${c.brief}`;
  } else if (kind === "prioritization") {
    const p = prioritizationSetFor(profile.track, state.usedRefs);
    refId = p.id;
    note = `Prioritisation exercise "${p.title}" is now open: ${p.brief} Items: ${p.items.map((i) => i.text).join("; ")}.`;
  } else {
    refId = "practical_fit";
    note = "The practical details form is now open for the candidate to fill in and confirm.";
  }
  const next = openExercise(state, kind, refId, now);
  if (kind === "system_design" || kind === "domain_case" || kind === "mgmt_case" || kind === "prioritization") {
    await db
      .insert(schema.exerciseResponses)
      .values({ sessionId: ctx.session.id, kind, refId, content: {} })
      .onConflictDoNothing();
  }
  return { state: next, note };
}

export interface CodingWorkspace {
  kind: "coding";
  sectionKey: string;
  problem: { id: string; title: string; difficulty: string; statement: string; samples: { input: string; output: string }[] };
  languages: { id: Language; label: string }[];
  starter: Record<string, string>;
  latest: { language: Language; code: string } | null;
  submitted: boolean;
  lastSubmit: { passed: number; total: number } | null;
  hintsUsed: number;
}

export interface TextExerciseWorkspace {
  kind: "system_design" | "domain_case" | "mgmt_case";
  sectionKey: string;
  title: string;
  brief: string;
  minutes: number;
  template: { key: string; label: string }[];
  content: Record<string, string>;
  submitted: boolean;
}

export interface PracticalFitWorkspace {
  kind: "practical_fit";
  sectionKey: string;
  askCompensation: boolean;
  currency: string;
  data: PracticalFitData;
  submitted: boolean;
}

export interface RepoWorkspace {
  kind: "repo";
  repos: { projectName: string; url: string | null; questions: { question: string; filePath: string; snippet: string }[] }[];
}

export interface PrioritizationWorkspace {
  kind: "prioritization";
  sectionKey: string;
  title: string;
  brief: string;
  minutes: number;
  items: { id: string; text: string }[];
  content: Record<string, string>;
  submitted: boolean;
}

export type Workspace = CodingWorkspace | TextExerciseWorkspace | PrioritizationWorkspace | PracticalFitWorkspace | RepoWorkspace | { kind: "none" };

export async function workspaceFor(ctx: SessionContext, state: SessionState): Promise<Workspace> {
  const sec = currentSection(state);
  if (!sec) return { kind: "none" };
  if (sec.key === "github") {
    const repos = ctx.repos
      .filter((r) => r.status === "ready")
      .map((r) => ({
        projectName: r.projectName,
        url: r.url,
        questions: (((r.analysis as { insight?: RepoInsight } | null)?.insight?.questions ?? []) as RepoInsight["questions"]).map((q) => ({
          question: q.question,
          filePath: q.filePath,
          snippet: q.snippet,
        })),
      }));
    return repos.length ? { kind: "repo", repos } : { kind: "none" };
  }
  const ex: ExerciseState | undefined = state.exercises[sec.key];
  if (!ex) return { kind: "none" };
  if (ex.kind === "coding") {
    const p = (await getProblem(ex.refId))!;
    const [latest] = await db
      .select()
      .from(schema.codeRuns)
      .where(eq(schema.codeRuns.sessionId, ctx.session.id))
      .orderBy(desc(schema.codeRuns.createdAt))
      .limit(1);
    const [lastSubmit] = await db
      .select()
      .from(schema.codeRuns)
      .where(and(eq(schema.codeRuns.sessionId, ctx.session.id), eq(schema.codeRuns.kind, "submit")))
      .orderBy(desc(schema.codeRuns.createdAt))
      .limit(1);
    const langs = ctx.config.coding.languages;
    return {
      kind: "coding",
      sectionKey: sec.key,
      problem: { id: p.id, title: p.title, difficulty: p.difficulty, statement: p.statement, samples: p.samples },
      languages: langs.map((l) => ({ id: l, label: LANGUAGE_LABEL[l] })),
      starter: Object.fromEntries(langs.map((l) => [l, STARTER_CODE[l]])),
      latest: latest ? { language: latest.language as Language, code: latest.code } : null,
      submitted: !!ex.submittedAt,
      lastSubmit: lastSubmit ? { passed: (lastSubmit.results as { passed: number }).passed, total: (lastSubmit.results as { total: number }).total } : null,
      hintsUsed: ex.hintsUsed,
    };
  }
  if (ex.kind === "practical_fit") {
    return {
      kind: "practical_fit",
      sectionKey: sec.key,
      askCompensation: ctx.settings.askCompensation,
      currency: ctx.config.practicalFitBand.currency,
      data: (ctx.practicalFit?.data as PracticalFitData) ?? emptyPracticalFit(ctx.config.practicalFitBand.currency),
      submitted: !!ex.submittedAt,
    };
  }
  const [resp] = await db
    .select()
    .from(schema.exerciseResponses)
    .where(and(eq(schema.exerciseResponses.sessionId, ctx.session.id), eq(schema.exerciseResponses.kind, ex.kind)));
  if (ex.kind === "system_design") {
    const d = DESIGN_PROMPTS.find((x) => x.id === ex.refId)!;
    return { kind: "system_design", sectionKey: sec.key, title: d.title, brief: d.brief, minutes: sec.minutes, template: DESIGN_TEMPLATE, content: (resp?.content as Record<string, string>) ?? {}, submitted: !!ex.submittedAt };
  }
  if (ex.kind === "prioritization") {
    const p = PRIORITIZATION_SETS.find((x) => x.id === ex.refId)!;
    return { kind: "prioritization", sectionKey: sec.key, title: p.title, brief: p.brief, minutes: sec.minutes, items: p.items, content: (resp?.content as Record<string, string>) ?? {}, submitted: !!ex.submittedAt };
  }
  const c = [...DOMAIN_CASES, ...MGMT_CASES].find((x) => x.id === ex.refId)!;
  return { kind: ex.kind as "domain_case" | "mgmt_case", sectionKey: sec.key, title: c.title, brief: c.brief, minutes: c.minutes, template: c.template, content: (resp?.content as Record<string, string>) ?? {}, submitted: !!ex.submittedAt };
}

/** A compact text description of the open exercise's current state, for the interviewer's live-state block. */
export async function exerciseStateForModel(ctx: SessionContext, state: SessionState): Promise<string> {
  const sec = currentSection(state);
  const ex = sec ? state.exercises[sec.key] : undefined;
  if (!sec || !ex) return "";
  if (ex.kind === "coding") {
    const p = (await getProblem(ex.refId))!;
    const runs = await db
      .select()
      .from(schema.codeRuns)
      .where(eq(schema.codeRuns.sessionId, ctx.session.id))
      .orderBy(desc(schema.codeRuns.createdAt))
      .limit(5);
    const latest = runs[0];
    const lastRun = runs.find((r) => r.kind !== "snapshot");
    const res = lastRun?.results as { passed: number; total: number; compileError?: string } | undefined;
    return [
      `Exercise: coding problem "${p.title}" (${p.difficulty}). Statement:\n${p.statement}`,
      latest ? `Candidate's latest code (${latest.language}):\n\`\`\`\n${latest.code.slice(0, 6000)}\n\`\`\`` : "Candidate has not written code yet.",
      lastRun ? `Last ${lastRun.kind}: ${res?.passed}/${res?.total} ${lastRun.kind === "submit" ? "hidden" : "sample"} tests passed${res?.compileError ? ` (compile error: ${res.compileError.slice(0, 300)})` : ""}.` : "No runs yet.",
      `Submitted: ${ex.submittedAt ? "yes" : "no"}. Hints used: ${ex.hintsUsed} (max level ${ex.maxHintLevel}). Hint requested now: ${state.hintRequested ? "YES — give one hint via give_hint" : "no"}.`,
    ].join("\n");
  }
  if (ex.kind === "practical_fit") {
    return `Practical details form: ${ex.submittedAt ? `confirmed by candidate: ${JSON.stringify(ctx.practicalFit?.data ?? {})}` : "not yet confirmed"}.`;
  }
  const [resp] = await db
    .select()
    .from(schema.exerciseResponses)
    .where(and(eq(schema.exerciseResponses.sessionId, ctx.session.id), eq(schema.exerciseResponses.kind, ex.kind)));
  const content = Object.entries((resp?.content as Record<string, string>) ?? {})
    .filter(([, v]) => v?.trim())
    .map(([k, v]) => `[${k}] ${v.slice(0, 1500)}`)
    .join("\n");
  const title = writtenExerciseInfo(ex.kind, ex.refId)?.title;
  return `Exercise: "${title}" (${ex.kind}). Submitted: ${ex.submittedAt ? "yes" : "no"}.\nCandidate's written response so far:\n${content || "(empty)"}`;
}
