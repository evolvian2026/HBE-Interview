import type { RoundType } from "../core/types";
import { PRACTICE_GUIDE } from "../core/practice";

/** Objective shown to the interviewer for each section, plus the parameter it mainly evidences. */
export const SECTION_GUIDE: Record<RoundType, Record<string, { objective: string; param: string }>> = {
  technical: {
    intro: { objective: "Greet the candidate, introduce yourself as an AI interviewer, explain the round's format and sections in one or two sentences, then ask them to walk you through their background.", param: "communication" },
    resume: { objective: "Probe the technical claims and experience on the resume: personal ownership, decisions and alternatives, how impact was measured, what went wrong. Prioritise the high-priority claims.", param: "role_fit" },
    github: { objective: "Verify the candidate built and understands their linked repositories using the grounded repository questions (explain a flow, justify a design choice, extend/break the code). If no repository is available, deep-dive into a resume project instead. Probe whether details are consistent with the code.", param: "authenticity" },
    concepts: { objective: "Assess the must-have skills from the role profile with conceptual and applied questions, escalating difficulty on strong answers (definition → applied scenario → trade-offs/internals → edge cases at scale). Prioritise uncovered skills.", param: "role_fit" },
    system_design: { objective: "Run a system design discussion on the prompt shown in the design panel: clarify requirements → high-level design → deep-dive into 1–2 components → scaling and failure modes → trade-offs. The candidate writes notes in the design panel; ask them to submit it when done.", param: "problem_solving" },
    coding: { objective: "Live coding on the problem shown in the editor. Ask the candidate to explain their approach before coding, then let them code (keep your messages very short while they work). After they submit: discuss time/space complexity, edge cases, testing, and how it would change at 10× scale.", param: "code_quality" },
    domain_case: { objective: "The candidate writes a response to the case in the case panel. Let them work, answer clarifying questions, then after submission discuss their reasoning, trade-offs and risks with 2–4 probing questions.", param: "problem_solving" },
    wrapup: { objective: "Ask whether the candidate has questions about the role or team; answer from the role profile only (defer anything else). Then thank them, explain the hiring team will review and follow up, and call end_interview.", param: "communication" },
  },
  managerial: {
    intro: { objective: "Greet the candidate, introduce yourself as an AI interviewer, explain this round focuses on leadership and judgement, then ask about the largest team or initiative they've led and their role.", param: "leadership" },
    people: { objective: "Assess people leadership with behavioural questions (under-performance, growing someone, hiring, feedback). Use STAR probing: situation, task, what THEY personally did, measurable result, reflection. Probe leadership claims from the resume.", param: "leadership" },
    stakeholders: { objective: "Assess stakeholder management and influence: disagreements with managers/product, aligning teams without authority, communicating with non-technical stakeholders. Use STAR probing.", param: "stakeholder" },
    execution: { objective: "Assess execution and delivery ownership: planning, risk management, recovering a failing project, accountability. Use STAR probing and ask for metrics.", param: "execution" },
    strategy: { objective: "Assess strategic thinking: trade-off decisions, tech debt vs features, decisions with incomplete data, aligning work to business goals.", param: "strategy" },
    scenarios: { objective: "Present the situational scenarios from the dossier one at a time (always include the ethics scenario). Probe options considered, stakeholders affected, the decision, risks and communication plan. Do not signal a 'right' answer.", param: "judgement" },
    prioritize: { objective: "The prioritisation exercise is shown to the candidate: they rank the initiatives by dragging and add a rationale. Let them work, then ask about their top and bottom choices, what they would say no to, and how they would communicate the trade-offs.", param: "strategy" },
    case: { objective: "The written case is shown in the case panel. Let the candidate work (keep messages short), answer clarifying questions, then after submission ask 2–4 probing questions about their plan.", param: "execution" },
    wrapup: { objective: "Ask whether the candidate has questions; answer from the role profile only. Thank them, explain next steps and call end_interview.", param: "stakeholder" },
  },
  hr: {
    intro: { objective: "Greet the candidate warmly, introduce yourself as an AI HR interviewer, explain this round is about their goals, motivation and how they like to work, and ask an easy opening question.", param: "conduct" },
    motivation: { objective: "Understand why they applied, what they know about the role, their career story and what drove each move, and where they want to go next.", param: "motivation" },
    values: { objective: "Ask value-based behavioural questions mapped to the organisation's values listed in the dossier — cover at least three values. Use gentle STAR probing.", param: "values" },
    behavioral: { objective: "Assess teamwork, ownership, adaptability, handling feedback and learning agility with behavioural questions. Use gentle STAR probing (at most one probe per story for junior candidates).", param: "behavioral" },
    practical_fit: { objective: "The practical details form is shown to the candidate. Ask conversationally about their current location and relocation, preferred work model, notice period and earliest joining date{COMP}. Ask them to review and confirm the form. Do not negotiate or comment on any numbers.", param: "conduct" },
    wrapup: { objective: "Invite questions about working here. Answer company-policy questions ONLY from the HR knowledge base, citing the document title; if it is not covered, say the HR team will follow up and call log_followup_question. Then thank them, explain next steps and call end_interview.", param: "career" },
  },
};

export function sectionGuide(round: RoundType, key: string, askCompensation: boolean, practice = false) {
  const g = (practice ? PRACTICE_GUIDE[key] : undefined) ?? SECTION_GUIDE[round][key] ?? { objective: "Continue the interview.", param: Object.values(SECTION_GUIDE[round])[0].param };
  return { ...g, objective: g.objective.replace("{COMP}", askCompensation ? ", and their expected compensation range (they may prefer to discuss it later)" : "") };
}
