import type { ParameterDef, RoleCategory, RoundType, Track } from "./types";

export const PARAMETERS: Record<RoundType, ParameterDef[]> = {
  technical: [
    {
      id: "role_fit",
      label: "Role Fit",
      description: "Demonstrated skills, depth and seniority against the JD's must-have and nice-to-have skills.",
      anchors: {
        1: "Few must-have skills demonstrated; level far below the role.",
        3: "Most must-haves demonstrated at a working level; some gaps.",
        5: "All must-haves demonstrated with depth beyond the level; strong nice-to-haves.",
      },
    },
    {
      id: "authenticity",
      label: "Resume & Project Authenticity",
      description: "Whether the candidate actually did what they claim and can explain their own projects and code in depth.",
      anchors: {
        1: "Cannot explain own projects or code; answers contradict the repo or resume.",
        3: "Explains main flows but vague on decisions or details; some generic answers.",
        5: "Explains non-obvious decisions, alternatives tried and bugs fixed; details consistent with the repo.",
      },
    },
    {
      id: "code_quality",
      label: "Code Quality",
      description: "Correctness, readability, structure, edge cases, idiomatic use and testing mindset.",
      anchors: {
        1: "Does not compile or run; no structure; ignores edge cases.",
        3: "Correct for main cases; readable; some edge cases missed; little testing thought.",
        5: "Correct including edge cases; clean, idiomatic, well structured; proactively discusses tests.",
      },
    },
    {
      id: "problem_solving",
      label: "Problem-Solving",
      description: "Decomposition, reasoning, trade-offs, complexity awareness and effective use of hints.",
      anchors: {
        1: "Cannot decompose the problem; no workable approach even with hints.",
        3: "Reaches a workable approach with some hints; basic complexity awareness.",
        5: "Clarifies requirements, compares approaches, reaches an optimal solution with precise trade-off reasoning.",
      },
    },
    {
      id: "communication",
      label: "Communication Clarity",
      description: "Structured, accurate and concise explanations that answer what was asked.",
      anchors: {
        1: "Unclear, disorganised or does not answer the question.",
        3: "Generally clear; occasionally rambling or imprecise.",
        5: "Structured, concise and precise; adapts depth to the question.",
      },
    },
  ],
  managerial: [
    {
      id: "leadership",
      label: "Leadership & People Development",
      description: "Mentoring, building teams, feedback, handling under-performance, hiring and raising the bar.",
      anchors: {
        1: "No real examples of developing others; avoids people issues.",
        3: "Some examples of mentoring and feedback; handles issues reactively.",
        5: "Concrete examples of growing people and handling under-performance fairly, with measurable outcomes.",
      },
    },
    {
      id: "stakeholder",
      label: "Stakeholder Management & Influence",
      description: "Managing up and across, negotiation and influencing without authority.",
      anchors: {
        1: "Escalates or avoids conflict; cannot influence without authority.",
        3: "Manages stakeholders adequately; some examples of alignment.",
        5: "Proactively aligns diverse stakeholders with clear influence strategies; turns conflict into outcomes.",
      },
    },
    {
      id: "execution",
      label: "Execution & Delivery Ownership",
      description: "Planning, prioritisation, risk management and accountability for outcomes.",
      anchors: {
        1: "Blames others; no planning or risk practices.",
        3: "Plans and delivers with some risk management; partial ownership.",
        5: "Strong ownership; anticipates risks; recovers failing initiatives with clear actions and metrics.",
      },
    },
    {
      id: "strategy",
      label: "Strategic Thinking & Decision-Making",
      description: "Long-term thinking, explicit trade-offs, data-informed decisions aligned to business goals.",
      anchors: {
        1: "Decisions are ad hoc; no trade-off reasoning.",
        3: "Reasonable decisions with some trade-off awareness; short-term focus.",
        5: "Ties decisions to business goals with explicit trade-offs, data and a long-term view.",
      },
    },
    {
      id: "judgement",
      label: "Situational Judgement & Conflict Resolution",
      description: "Quality, fairness and ethics of reasoning in realistic dilemmas.",
      anchors: {
        1: "Unfair, unethical or harmful choices in scenarios.",
        3: "Reasonable choices; misses some stakeholders or risks.",
        5: "Fair, ethical, balanced decisions considering all stakeholders, with a clear communication plan.",
      },
    },
  ],
  hr: [
    {
      id: "motivation",
      label: "Motivation & Role Interest",
      description: "Genuine, specific reasons for the role and company; understanding of what the role involves.",
      anchors: {
        1: "Generic or no reasons; unaware of what the role involves.",
        3: "Reasonable reasons; general understanding of the role.",
        5: "Specific, genuine reasons tied to the role and company; clear understanding of expectations.",
      },
    },
    {
      id: "values",
      label: "Culture & Values Alignment",
      description: "Behavioural evidence that matches the organisation's configured values.",
      anchors: {
        1: "Evidence contradicts the organisation's values.",
        3: "Some evidence for some values.",
        5: "Strong behavioural evidence across most assessed values.",
      },
    },
    {
      id: "behavioral",
      label: "Behavioral Competencies",
      description: "Teamwork, ownership, adaptability, handling feedback and learning agility, shown through STAR examples.",
      anchors: {
        1: "No concrete examples; poor teamwork or feedback handling.",
        3: "Some concrete examples with partial STAR completeness.",
        5: "Rich, specific STAR examples showing ownership, adaptability and growth.",
      },
    },
    {
      id: "career",
      label: "Career Goals Alignment",
      description: "Coherence of the career story and alignment of the role with stated goals.",
      anchors: {
        1: "Incoherent career story; goals clearly misaligned with the role.",
        3: "Mostly coherent; partial alignment.",
        5: "Coherent narrative; the role is a clear, logical step toward stated goals.",
      },
    },
    {
      id: "conduct",
      label: "Professional Communication & Conduct",
      description: "Clarity, professionalism, respect, honesty and consistency of answers.",
      anchors: {
        1: "Unprofessional, inconsistent or evasive.",
        3: "Professional and generally clear.",
        5: "Highly professional, articulate, transparent and consistent.",
      },
    },
  ],
};

export function paramIds(round: RoundType): string[] {
  return PARAMETERS[round].map((p) => p.id);
}

export function paramLabel(round: RoundType, id: string): string {
  return PARAMETERS[round].find((p) => p.id === id)?.label ?? id;
}

export function defaultWeights(round: RoundType, category: RoleCategory, track: Track): Record<string, number> {
  if (round === "technical") {
    if (category === "coding") return { role_fit: 25, authenticity: 20, code_quality: 20, problem_solving: 20, communication: 15 };
    if (category === "technical_non_coding")
      return { role_fit: 30, authenticity: 25, code_quality: 5, problem_solving: 25, communication: 15 };
    return { role_fit: 35, authenticity: 20, code_quality: 0, problem_solving: 30, communication: 15 };
  }
  if (round === "managerial") {
    return track === "manager"
      ? { leadership: 25, stakeholder: 20, execution: 20, strategy: 20, judgement: 15 }
      : { leadership: 20, stakeholder: 25, execution: 20, strategy: 20, judgement: 15 };
  }
  return { motivation: 20, values: 25, behavioral: 25, career: 15, conduct: 15 };
}
