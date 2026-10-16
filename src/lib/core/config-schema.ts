import { z } from "zod";

const rec = z.enum(["strong_hire", "hire", "lean_no", "no_hire"]);

export const SectionSchema = z.object({
  key: z.string(),
  title: z.string().min(1).max(80),
  minutes: z.number().int().min(1).max(60),
  minQ: z.number().int().min(0).max(20),
  maxQ: z.number().int().min(1).max(30),
  enabled: z.boolean(),
  exercise: z.enum(["coding", "system_design", "domain_case", "mgmt_case", "prioritization", "practical_fit"]).optional(),
});

export const RoundSchema = z.object({
  type: z.enum(["technical", "managerial", "hr"]),
  enabled: z.boolean(),
  durationMin: z.number().int().min(10).max(120),
  personaName: z.string().min(1).max(40),
  sections: z.array(SectionSchema).min(1),
  pinnedQuestions: z.array(z.string().max(500)).max(5),
  weights: z.record(z.string(), z.number().min(0).max(100)),
  gate: z.object({ mode: z.enum(["auto", "manual", "always"]), threshold: rec }),
});

export const DriveConfigSchema = z.object({
  title: z.string().min(1).max(200),
  jdText: z.string().max(20000),
  roleProfile: z.object({
    category: z.enum(["coding", "technical_non_coding", "non_technical"]),
    seniority: z.enum(["intern", "junior", "mid", "senior", "lead", "manager", "director"]),
    track: z.enum(["ic", "manager"]),
    mustHaveSkills: z.array(z.string().max(80)).max(15),
    niceToHaveSkills: z.array(z.string().max(80)).max(15),
    responsibilities: z.array(z.string().max(400)).max(12),
    leadershipExpectations: z.array(z.string().max(400)).max(8),
    domain: z.string().max(200),
    summary: z.string().max(2000),
  }),
  rounds: z.array(RoundSchema).length(3),
  roundWeights: z.object({ technical: z.number().min(0).max(100), managerial: z.number().min(0).max(100), hr: z.number().min(0).max(100) }),
  bands: z.object({ strongHire: z.number(), hire: z.number(), leanNo: z.number() }),
  knockouts: z.object({ authenticity: z.boolean(), ethics: z.boolean(), noHireCap: z.boolean() }),
  coding: z.object({ languages: z.array(z.enum(["python", "javascript", "java", "cpp"])), difficulty: z.array(z.enum(["easy", "medium", "hard"])).min(1) }),
  practicalFitBand: z.object({
    currency: z.string().max(8),
    budgetMin: z.number().nullable(),
    budgetMax: z.number().nullable(),
    maxNoticeDays: z.number().int().nullable(),
    locations: z.array(z.string().max(80)),
    workModels: z.array(z.enum(["onsite", "hybrid", "remote"])),
    relocationSupport: z.boolean(),
  }),
  schedulingMode: z.enum(["staged", "single"]),
  nextRoundExpiryDays: z.number().int().min(1).max(30),
  inviteExpiryDays: z.number().int().min(1).max(90),
  reconnectWindowMin: z.number().int().min(5).max(60),
});
