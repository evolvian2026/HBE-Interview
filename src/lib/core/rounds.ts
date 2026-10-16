import { defaultWeights } from "./rubrics";
import type {
  Difficulty,
  DriveConfig,
  RoleProfile,
  RoundConfig,
  RoundType,
  SectionConfig,
  Seniority,
} from "./types";

const s = (
  key: string,
  title: string,
  minutes: number,
  minQ: number,
  maxQ: number,
  exercise?: SectionConfig["exercise"],
): SectionConfig => ({ key, title, minutes, minQ, maxQ, enabled: true, ...(exercise ? { exercise } : {}) });

const SENIOR_PLUS: Seniority[] = ["senior", "lead", "manager", "director"];
const MANAGER_LEVELS: Seniority[] = ["manager", "director"];

export function isSeniorPlus(s: Seniority) {
  return SENIOR_PLUS.includes(s);
}

/** Which rounds are enabled by default for a seniority (PRD §3.1). HR is always last. */
export function defaultRoundEnabled(round: RoundType, seniority: Seniority): boolean {
  if (round === "managerial") return isSeniorPlus(seniority);
  return true;
}

export function defaultRoundWeights(seniority: Seniority, managerialEnabled: boolean): Record<RoundType, number> {
  switch (seniority) {
    case "intern":
    case "junior":
      return { technical: 75, managerial: 0, hr: 25 };
    case "mid":
      return managerialEnabled ? { technical: 65, managerial: 15, hr: 20 } : { technical: 70, managerial: 0, hr: 30 };
    case "senior":
      return { technical: 55, managerial: 25, hr: 20 };
    case "lead":
      return { technical: 50, managerial: 30, hr: 20 };
    case "manager":
      return { technical: 35, managerial: 45, hr: 20 };
    case "director":
      return { technical: 25, managerial: 55, hr: 20 };
  }
}

export function technicalSections(profile: RoleProfile): SectionConfig[] {
  const { category, seniority } = profile;
  if (category === "non_technical") {
    return [
      s("intro", "Introduction", 3, 1, 2),
      s("resume", "Resume deep-dive", 10, 2, 6),
      s("concepts", "Domain concepts", 10, 2, 6),
      s("domain_case", "Domain case", 14, 2, 8, "domain_case"),
      s("wrapup", "Wrap-up", 3, 1, 2),
    ];
  }
  if (MANAGER_LEVELS.includes(seniority)) {
    return [
      s("intro", "Introduction", 3, 1, 2),
      s("resume", "Resume deep-dive", 8, 2, 5),
      s("github", "Project validation", 8, 2, 5),
      s("concepts", "Architecture & technical judgement", 12, 2, 6),
      s("system_design", "System design", 12, 2, 8, "system_design"),
      s("wrapup", "Wrap-up", 2, 1, 2),
    ];
  }
  if (category === "technical_non_coding") {
    const sections = [
      s("intro", "Introduction", 3, 1, 2),
      s("resume", "Resume deep-dive", 8, 2, 5),
      s("github", "Project validation", 10, 2, 6),
      s("concepts", "Technical concepts", 12, 3, 8),
    ];
    if (isSeniorPlus(seniority)) sections.push(s("system_design", "System design", 12, 2, 8, "system_design"));
    else sections.push(s("domain_case", "Technical scenario", 10, 2, 6, "domain_case"));
    sections.push(s("wrapup", "Wrap-up", 2, 1, 2));
    return sections;
  }
  // coding
  if (isSeniorPlus(seniority)) {
    return [
      s("intro", "Introduction", 3, 1, 2),
      s("resume", "Resume deep-dive", 7, 2, 5),
      s("github", "GitHub project validation", 10, 2, 6),
      s("concepts", "Concepts", 8, 2, 5),
      s("system_design", "System design", 15, 2, 8, "system_design"),
      s("coding", "Live coding", 15, 2, 10, "coding"),
      s("wrapup", "Wrap-up", 2, 1, 2),
    ];
  }
  return [
    s("intro", "Introduction", 3, 1, 2),
    s("resume", "Resume deep-dive", 8, 2, 5),
    s("github", "GitHub project validation", 10, 2, 6),
    s("concepts", "Concepts", 10, 3, 6),
    s("coding", "Live coding", 12, 2, 10, "coding"),
    s("wrapup", "Wrap-up", 2, 1, 2),
  ];
}

export function managerialSections(seniority: Seniority = "senior"): SectionConfig[] {
  const sections = [
    s("intro", "Introduction & leadership story", 4, 1, 3),
    s("people", "People leadership", 6, 2, 5),
    s("stakeholders", "Stakeholder management & influence", 5, 2, 4),
    s("execution", "Execution & delivery", 5, 2, 4),
    s("strategy", "Strategic thinking", 4, 1, 4),
    s("scenarios", "Situational scenarios", 6, 2, 5),
    s("case", "Written case exercise", 8, 2, 6, "mgmt_case"),
    // Drag-and-drop prioritisation (G-8): on by default for people-manager levels, available to all.
    { ...s("prioritize", "Prioritisation exercise", 5, 1, 4, "prioritization"), enabled: MANAGER_LEVELS.includes(seniority) },
    s("wrapup", "Wrap-up", 2, 1, 2),
  ];
  return sections;
}

export function hrSections(seniority: Seniority): SectionConfig[] {
  const short = seniority === "intern" || seniority === "junior";
  return [
    s("intro", "Introduction", 2, 1, 2),
    s("motivation", "Motivation & career story", short ? 4 : 5, 2, 4),
    s("values", "Values & culture", short ? 5 : 6, 2, 5),
    s("behavioral", "Behavioral competencies", short ? 4 : 6, 2, 5),
    s("practical_fit", "Practical details", 4, 1, 4, "practical_fit"),
    s("wrapup", "Your questions & close", short ? 1 : 2, 1, 3),
  ];
}

function sum(sections: SectionConfig[]) {
  return sections.filter((x) => x.enabled).reduce((a, b) => a + b.minutes, 0);
}

const PERSONAS: Record<RoundType, string> = {
  technical: "Aarav",
  managerial: "Meera",
  hr: "Riya",
};

export function defaultDifficulty(seniority: Seniority): Difficulty[] {
  if (seniority === "intern" || seniority === "junior") return ["easy", "medium"];
  if (seniority === "mid") return ["medium"];
  return ["medium", "hard"];
}

export function buildRound(type: RoundType, profile: RoleProfile): RoundConfig {
  const sections =
    type === "technical" ? technicalSections(profile) : type === "managerial" ? managerialSections(profile.seniority) : hrSections(profile.seniority);
  return {
    type,
    enabled: defaultRoundEnabled(type, profile.seniority),
    durationMin: sum(sections),
    personaName: PERSONAS[type],
    sections,
    pinnedQuestions: [],
    weights: defaultWeights(type, profile.category, profile.track),
    gate: { mode: "auto", threshold: "hire" },
  };
}

/** Build a complete default drive configuration from a role profile (PRD §3). */
export function buildDefaultDriveConfig(title: string, jdText: string, profile: RoleProfile): DriveConfig {
  const rounds = (["technical", "managerial", "hr"] as RoundType[]).map((t) => buildRound(t, profile));
  const mgr = rounds.find((r) => r.type === "managerial")!;
  return {
    title,
    jdText,
    roleProfile: profile,
    rounds,
    roundWeights: defaultRoundWeights(profile.seniority, mgr.enabled),
    bands: { strongHire: 80, hire: 65, leanNo: 50 },
    knockouts: { authenticity: true, ethics: true, noHireCap: true },
    coding: { languages: ["python", "javascript", "java", "cpp"], difficulty: defaultDifficulty(profile.seniority) },
    practicalFitBand: {
      currency: "INR",
      budgetMin: null,
      budgetMax: null,
      maxNoticeDays: 60,
      locations: [],
      workModels: ["onsite", "hybrid", "remote"],
      relocationSupport: false,
    },
    schedulingMode: "staged",
    nextRoundExpiryDays: 7,
    inviteExpiryDays: 14,
    reconnectWindowMin: 15,
  };
}

/** Enabled rounds in canonical order: Technical → Managerial (if applicable) → HR (always last). */
export function enabledRounds(config: DriveConfig): RoundConfig[] {
  const order: RoundType[] = ["technical", "managerial", "hr"];
  return order.map((t) => config.rounds.find((r) => r.type === t)).filter((r): r is RoundConfig => !!r && r.enabled);
}

export interface ConfigIssue {
  path: string;
  message: string;
}

export function validateDriveConfig(config: DriveConfig): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  if (!config.title.trim()) issues.push({ path: "title", message: "Title is required" });
  if (config.jdText.trim().length < 200)
    issues.push({ path: "jdText", message: "Add more detail to the JD (at least 200 characters)" });
  const rounds = enabledRounds(config);
  if (rounds.length === 0) issues.push({ path: "rounds", message: "Enable at least one round" });
  for (const r of rounds) {
    const total = Object.values(r.weights).reduce((a, b) => a + b, 0);
    if (Math.round(total) !== 100) issues.push({ path: `rounds.${r.type}.weights`, message: `${r.type} parameter weights must total 100 (now ${total})` });
    if (!r.sections.some((x) => x.enabled)) issues.push({ path: `rounds.${r.type}.sections`, message: `${r.type} round needs at least one section` });
  }
  const rwTotal = rounds.reduce((a, r) => a + (config.roundWeights[r.type] ?? 0), 0);
  if (rounds.length && Math.round(rwTotal) !== 100)
    issues.push({ path: "roundWeights", message: `Round weights of enabled rounds must total 100 (now ${rwTotal})` });
  if (config.coding.languages.length === 0) issues.push({ path: "coding.languages", message: "Pick at least one coding language" });
  return issues;
}

/** Rescale section minutes so they sum to the round duration. */
export function rescaleSections(round: RoundConfig): RoundConfig {
  const enabled = round.sections.filter((x) => x.enabled);
  const total = sum(enabled);
  if (!total || total === round.durationMin) return round;
  const factor = round.durationMin / total;
  return {
    ...round,
    sections: round.sections.map((x) => (x.enabled ? { ...x, minutes: Math.max(1, Math.round(x.minutes * factor)) } : x)),
  };
}
