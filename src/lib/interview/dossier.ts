import { PARAMETERS } from "../core/rubrics";
import { SENIORITY_LABEL, CATEGORY_LABEL } from "../core/types";
import { currentSection, timeLeftSec, sectionElapsedSec, uncoveredParameters, LIMITS, type SessionState } from "../core/interview";
import { SECTION_QUESTIONS, SCENARIOS } from "../content";
import { sectionGuide } from "./sections";
import type { SessionContext } from "./load";
import type { RepoInsight } from "../ai/analyzers";
import { PRACTICE_INSTRUCTION, practiceQuestion } from "../core/practice";

export function roleBlock(ctx: SessionContext): string {
  const p = ctx.config.roleProfile;
  const round = ctx.round!;
  const rubric = PARAMETERS[round.type]
    .filter((x) => (round.weights[x.id] ?? 0) > 0)
    .map((x) => `- ${x.id}: ${x.label} — ${x.description}`)
    .join("\n");
  return `<role_profile>
Title: ${ctx.config.title}
Category: ${CATEGORY_LABEL[p.category]}; Seniority: ${SENIORITY_LABEL[p.seniority]}; Track: ${p.track === "manager" ? "People manager" : "Individual contributor"}
Domain: ${p.domain}
Summary: ${p.summary}
Must-have skills: ${p.mustHaveSkills.join(", ") || "—"}
Nice-to-have skills: ${p.niceToHaveSkills.join(", ") || "—"}
Responsibilities: ${p.responsibilities.join("; ") || "—"}
Leadership expectations: ${p.leadershipExpectations.join("; ") || "—"}
</role_profile>
<rubric_parameters>
${rubric}
</rubric_parameters>
<round_sections>
${ctx.state.sections.map((s) => `- ${s.key}: ${s.title} (~${s.minutes} min)`).join("\n")}
</round_sections>`;
}

export function dossierBlock(ctx: SessionContext): string {
  const parts: string[] = [];
  const a = ctx.analysis;
  const round = ctx.round!.type;
  const firstName = ctx.candidate.name.split(/\s+/)[0] ?? "the candidate";
  parts.push(`Candidate first name: ${firstName}`);
  // Practice runs see only the first name and the role: nothing from the resume, repositories or earlier rounds.
  if (ctx.practice) return `<candidate_dossier>\n${parts.join("\n\n")}\n\n${PRACTICE_INSTRUCTION}\n</candidate_dossier>`;
  if (a) {
    const prof = a.profile;
    parts.push(
      `Resume summary: ${prof.summary}\nTotal experience: ${prof.totalYears ?? "?"} years; leadership: ${prof.leadershipYears ?? "?"} years`,
      `Experience:\n${prof.experience
        .slice(0, 6)
        .map((e) => `- ${e.title} at ${e.company} (${e.start}–${e.end})${e.teamSizeManaged ? `, managed ${e.teamSizeManaged}` : ""}: ${e.bullets.slice(0, 4).join(" | ")}`)
        .join("\n")}`,
      `Projects:\n${prof.projects.map((p) => `- ${p.name}: ${p.description} [${p.techStack.join(", ")}]`).join("\n") || "—"}`,
    );
    const claims = (a.claims ?? []).filter((c) => c.round === round).sort((x, y) => y.priority - x.priority);
    if (claims.length) parts.push(`Resume claims to probe in this round:\n${claims.map((c) => `- (${c.priority}) ${c.text}`).join("\n")}`);
    if (round === "technical" && a.jdMatch) {
      const missing = a.jdMatch.skills.filter((s) => s.status !== "evidenced").map((s) => `${s.skill} (${s.status})`);
      if (missing.length) parts.push(`Must-have skills not evidenced on resume: ${missing.join(", ")}`);
    }
  }
  if (round === "technical") {
    const ready = ctx.repos.filter((r) => r.status === "ready");
    if (ready.length) {
      parts.push(
        `GitHub repositories (analysis; authenticity signals are indicators, not verdicts):\n${ready
          .map((r) => {
            const an = r.analysis as { insight?: RepoInsight; overall?: string; signals?: { label: string; value: string }[] } | null;
            const ins = an?.insight;
            return `## ${r.projectName} — ${r.url}
Summary: ${ins?.summary ?? ""}
Architecture: ${ins?.architecture ?? ""}
Design decisions: ${(ins?.designDecisions ?? []).join("; ")}
Tech match: ${ins?.techMatch?.note ?? ""}
Signals: ${(an?.signals ?? []).map((s) => `${s.label}: ${s.value}`).join("; ")}
Grounded questions (snippets are visible to the candidate):
${(ins?.questions ?? []).map((q, i) => `${i + 1}. [${q.kind}] ${q.question} (file: ${q.filePath})`).join("\n")}`;
          })
          .join("\n\n")}`,
      );
    } else {
      const reasons = ctx.repos.map((r) => `${r.projectName}: ${r.notPublicReason ?? r.error ?? r.status}`).join("; ");
      parts.push(`No analysed repository is available${reasons ? ` (${reasons})` : ""}. In the project validation section, deep-dive into resume projects instead.`);
    }
  }
  if (ctx.prior.length) {
    parts.push(
      `Summaries of earlier rounds (context only; avoid repeating their questions; probe open concerns where relevant):\n${ctx.prior
        .map((p) => `- ${p.roundType}: ${p.summary} Strengths: ${p.strengths.join("; ")}. Concerns: ${p.concerns.join("; ")}.`)
        .join("\n")}`,
    );
  }
  if (round === "managerial") {
    const ids = ctx.state.plan?.scenarios ?? [];
    const sc = SCENARIOS.filter((s) => ids.includes(s.id));
    parts.push(`Situational scenarios to present in the scenarios section (one at a time, all of them):\n${sc.map((s) => `- ${s.text}${s.ethics ? " [ethics]" : ""}`).join("\n")}`);
  }
  if (round === "hr") {
    parts.push(
      `Organisation values (cover at least three in the values section):\n${ctx.settings.values.map((v) => `- ${v.name}: ${v.description} Observable behaviours: ${v.behaviors.join("; ")}`).join("\n")}`,
    );
    if (ctx.kbMode === "retrieval") {
      // Large KB: list the documents here; the passages relevant to the candidate's latest message arrive each turn.
      parts.push(
        `<hr_knowledge_base mode="search">\nThe organisation's HR knowledge base has ${ctx.kb.length} documents: ${ctx.kb.map((d) => `"${d.title}"`).join(", ")}.\nFor each candidate message, the most relevant passages appear in <policy_passages> inside <interview_state>. Answer policy questions only from those passages and cite the document title; if they don't answer the question, say the HR team will follow up and call log_followup_question.\n</hr_knowledge_base>`,
      );
    } else {
      const kb = ctx.kb.map((d) => `### ${d.title}\n${d.content}`).join("\n\n");
      parts.push(`<hr_knowledge_base>\n${kb || "(no documents — defer all policy questions to the HR team)"}\n</hr_knowledge_base>`);
    }
    if (ctx.settings.companyBlurb) parts.push(`About the company: ${ctx.settings.companyBlurb}`);
    parts.push(`Compensation: ${ctx.settings.askCompensation ? "you may ask for the expected compensation range (never current or past salary)." : "do NOT ask about compensation at all; if the candidate raises it, say the recruiter will discuss it later."}`);
  }
  if (ctx.round!.pinnedQuestions.length) parts.push(`Questions the hiring team asked you to include:\n${ctx.round!.pinnedQuestions.map((q) => `- ${q}`).join("\n")}`);
  return `<candidate_dossier>\n${parts.join("\n\n")}\n</candidate_dossier>`;
}

/** Suggested (unused) questions for the current section. */
export function questionPool(ctx: SessionContext, state: SessionState): string[] {
  const sec = currentSection(state);
  if (!sec) return [];
  if (ctx.practice) return sec.key === "practice_sample" ? [practiceQuestion(ctx.config)].filter((q) => !state.usedRefs.includes(`q:${hash(q)}`)) : [];
  const round = ctx.round!.type;
  const pool: string[] = [];
  if (round === "technical" && sec.key === "github") {
    for (const r of ctx.repos.filter((x) => x.status === "ready")) {
      for (const q of ((r.analysis as { insight?: RepoInsight } | null)?.insight?.questions ?? [])) pool.push(q.question);
    }
  }
  const claims = (ctx.analysis?.claims ?? []).filter((c) => c.round === round);
  if ((round === "technical" && sec.key === "resume") || (round === "managerial" && ["intro", "people"].includes(sec.key)) || (round === "hr" && sec.key === "motivation")) {
    for (const c of claims) pool.push(`Your resume mentions: "${c.text}". Can you walk me through that — what exactly was your role?`);
  }
  if (round === "technical" && sec.key === "concepts") {
    for (const s of ctx.config.roleProfile.mustHaveSkills) pool.push(`How have you used ${s} in practice, and what's a non-obvious pitfall with it?`);
  }
  if (round === "managerial" && sec.key === "scenarios") {
    const ids = state.plan?.scenarios ?? [];
    for (const s of SCENARIOS.filter((x) => ids.includes(x.id))) pool.push(s.text);
  }
  if (round === "hr" && sec.key === "values") {
    for (const v of ctx.settings.values) pool.push(`Tell me about a time you showed ${v.name.toLowerCase()} at work — what did you do?`);
  }
  if (round === "hr" && sec.key === "practical_fit") {
    pool.push("Let's cover a few practical details. Where are you currently based, and what work arrangement do you prefer?");
  }
  pool.push(...(SECTION_QUESTIONS[`${round}.${sec.key}`] ?? []));
  pool.push(...ctx.round!.pinnedQuestions);
  return pool.filter((q) => !state.usedRefs.includes(`q:${hash(q)}`)).slice(0, 8);
}

export function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export type ServerInstruction = "open" | "section_start" | "continue" | "move_on" | "closing" | "time_up";

const INSTRUCTION_TEXT: Record<ServerInstruction, string> = {
  open: "The round is starting. Open the interview as described in the section objective.",
  section_start: "A new section has just started. Briefly signpost it (one short sentence) and ask its first question.",
  continue: "Continue: assess the last answer, then follow up or ask the next question for this section.",
  move_on: "The candidate struggled with this topic after follow-ups or skipped it. Acknowledge neutrally and move to a different topic.",
  closing: "Wrap-up: answer any final question briefly, thank the candidate, say the hiring team will review and follow up, then call end_interview.",
  time_up: "Time is up for this round. In two sentences, thank the candidate and close the interview, then call end_interview. Do not ask another question.",
};

export function liveStateText(ctx: SessionContext, state: SessionState, now: Date, instruction: ServerInstruction, exerciseText: string, pool: string[]): string {
  const sec = currentSection(state);
  const round = ctx.round!;
  const left = timeLeftSec(ctx.session.deadlineAt, now, state);
  const guide = sec ? sectionGuide(round.type, sec.key, ctx.settings.askCompensation, ctx.practice) : null;
  const secLeft = sec ? Math.max(0, Math.round((sec.minutes * 60 - sectionElapsedSec(sec, now)) / 60)) : 0;
  const coverage = PARAMETERS[round.type]
    .filter((p) => (round.weights[p.id] ?? 0) > 0)
    .map((p) => {
      const c = state.coverage[p.id];
      return `${p.id}: ${c?.asked ? `assessed ${c.asked}× (best ${c.best})${c.struggled ? ", struggled" : ""}` : "not yet assessed"}`;
    })
    .join("; ");
  const uncovered = uncoveredParameters(state, round.weights);
  return [
    `Round time left: ${Math.floor(left / 60)} min ${left % 60}s.`,
    sec ? `Current section: "${sec.title}" (key ${sec.key}) — ${sec.askedQ} of max ${sec.maxQ} exchanges used (min ${sec.minQ}); about ${secLeft} min left in this section.` : "",
    guide ? `Section objective: ${guide.objective}` : "",
    `Coverage: ${coverage}.`,
    uncovered.length ? `Not yet assessed (prioritise where relevant): ${uncovered.join(", ")}.` : "",
    `Follow-ups used on the current topic: ${state.followUps} of ${LIMITS.maxFollowUps}.`,
    exerciseText,
    pool.length ? `Suggested questions for this section (adapt them; you may write your own):\n${pool.map((q) => `- ${q}`).join("\n")}` : "",
    ctx.practice ? `Practice mode: ${PRACTICE_INSTRUCTION}` : "",
    `Server instruction: ${ctx.practice && instruction === "closing" ? "Wrap-up: give one or two friendly tips, wish them luck for the real interview, then call end_interview." : INSTRUCTION_TEXT[instruction]}`,
  ]
    .filter(Boolean)
    .join("\n");
}
