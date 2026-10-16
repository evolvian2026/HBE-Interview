export type RoleCategory = "coding" | "technical_non_coding" | "non_technical";
export type Seniority = "intern" | "junior" | "mid" | "senior" | "lead" | "manager" | "director";
export type Track = "ic" | "manager";
export type RoundType = "technical" | "managerial" | "hr";
export type Recommendation = "strong_hire" | "hire" | "lean_no" | "no_hire";
export type Confidence = "high" | "medium" | "low";
export type Language = "python" | "javascript" | "java" | "cpp";
export type Difficulty = "easy" | "medium" | "hard";

export const ROUND_ORDER: RoundType[] = ["technical", "managerial", "hr"];

export const ROUND_LABEL: Record<RoundType, string> = {
  technical: "Technical / Functional Round",
  managerial: "Managerial Round",
  hr: "HR Round",
};

export const SENIORITY_LABEL: Record<Seniority, string> = {
  intern: "Intern / Fresher",
  junior: "Junior (0–2 yrs)",
  mid: "Mid (2–5 yrs)",
  senior: "Senior (5–8 yrs)",
  lead: "Lead / Staff / Principal",
  manager: "Manager",
  director: "Senior Manager / Director",
};

export const CATEGORY_LABEL: Record<RoleCategory, string> = {
  coding: "Coding",
  technical_non_coding: "Technical (non-coding)",
  non_technical: "Non-technical",
};

export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  strong_hire: "Strong Hire",
  hire: "Hire",
  lean_no: "Lean No",
  no_hire: "No Hire",
};

export interface RoleProfile {
  category: RoleCategory;
  seniority: Seniority;
  track: Track;
  mustHaveSkills: string[];
  niceToHaveSkills: string[];
  responsibilities: string[];
  leadershipExpectations: string[];
  domain: string;
  summary: string;
}

/** Kind of workspace exercise that a section opens. */
export type ExerciseKind = "coding" | "system_design" | "domain_case" | "mgmt_case" | "practical_fit";

export interface SectionConfig {
  key: string;
  title: string;
  minutes: number;
  /** Minimum AI exchanges before the section may be closed early. */
  minQ: number;
  /** Maximum AI exchanges in this section. */
  maxQ: number;
  enabled: boolean;
  exercise?: ExerciseKind;
}

export interface GateConfig {
  mode: "auto" | "manual" | "always";
  threshold: Recommendation;
}

export interface RoundConfig {
  type: RoundType;
  enabled: boolean;
  durationMin: number;
  personaName: string;
  sections: SectionConfig[];
  pinnedQuestions: string[];
  /** Parameter id -> weight (sums to 100). */
  weights: Record<string, number>;
  /** Gate applied after this round, before the next enabled round. */
  gate: GateConfig;
}

export interface PracticalFitBand {
  currency: string;
  budgetMin: number | null;
  budgetMax: number | null;
  maxNoticeDays: number | null;
  locations: string[];
  workModels: ("onsite" | "hybrid" | "remote")[];
  relocationSupport: boolean;
}

export interface DriveConfig {
  title: string;
  jdText: string;
  roleProfile: RoleProfile;
  rounds: RoundConfig[];
  roundWeights: Record<RoundType, number>;
  bands: { strongHire: number; hire: number; leanNo: number };
  knockouts: { authenticity: boolean; ethics: boolean; noHireCap: boolean };
  coding: { languages: Language[]; difficulty: Difficulty[] };
  practicalFitBand: PracticalFitBand;
  schedulingMode: "staged" | "single";
  nextRoundExpiryDays: number;
  inviteExpiryDays: number;
  reconnectWindowMin: number;
}

export interface ParameterDef {
  id: string;
  label: string;
  description: string;
  anchors: { 1: string; 3: string; 5: string };
}

export interface ParamScore {
  score: number | null;
  justification: string;
  evidence: EvidenceItem[];
  confidence: Confidence;
  override?: { score: number; reason: string; by: string; at: string };
}

export interface EvidenceItem {
  type: "transcript" | "code" | "artifact" | "repo";
  ref: string;
  quote: string;
}
