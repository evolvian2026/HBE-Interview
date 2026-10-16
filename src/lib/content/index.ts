import problemsJson from "./problems.json";
import type { Difficulty, Language, RoleCategory, Seniority, Track } from "../core/types";

/* ------------------------------ Coding problems ----------------------------- */

export interface TestCase {
  input: string;
  output: string;
}
export interface CodingProblem {
  id: string;
  title: string;
  difficulty: Difficulty;
  tags: string[];
  statement: string;
  samples: TestCase[];
  hidden: TestCase[];
}

export const PROBLEMS = problemsJson as CodingProblem[];

export function problemById(id: string) {
  return PROBLEMS.find((p) => p.id === id);
}

const DOMAIN_TAGS: Record<string, string[]> = {
  backend: ["backend", "design"],
  fintech: ["fintech", "backend"],
  payments: ["fintech", "backend"],
  data: ["data"],
  analytics: ["data"],
  devops: ["devops"],
  cloud: ["devops"],
};

/** Pick a problem matching difficulty and (if possible) the JD domain, excluding already-used ones. */
export function pickProblem(opts: { difficulty: Difficulty[]; domain: string; skills: string[]; exclude: string[] }): CodingProblem {
  const text = `${opts.domain} ${opts.skills.join(" ")}`.toLowerCase();
  const wantTags = new Set<string>();
  for (const [k, tags] of Object.entries(DOMAIN_TAGS)) if (text.includes(k)) tags.forEach((t) => wantTags.add(t));
  const pool = PROBLEMS.filter((p) => opts.difficulty.includes(p.difficulty) && !opts.exclude.includes(p.id));
  const fallback = PROBLEMS.filter((p) => !opts.exclude.includes(p.id));
  const candidates = pool.length ? pool : fallback;
  const scored = candidates
    .map((p) => ({ p, s: p.tags.filter((t) => wantTags.has(t)).length + Math.random() * 0.5 }))
    .sort((a, b) => b.s - a.s);
  return scored[0].p;
}

export const LANGUAGE_LABEL: Record<Language, string> = {
  python: "Python 3",
  javascript: "JavaScript (Node.js)",
  java: "Java",
  cpp: "C++",
};

export const STARTER_CODE: Record<Language, string> = {
  python: `import sys


def solve(data: str) -> str:
    lines = data.strip().split("\\n")
    # TODO: parse the input and compute the answer
    return ""


if __name__ == "__main__":
    print(solve(sys.stdin.read()))
`,
  javascript: `const data = require("fs").readFileSync(0, "utf8");

function solve(data) {
  const lines = data.trim().split("\\n");
  // TODO: parse the input and compute the answer
  return "";
}

console.log(solve(data));
`,
  java: `import java.io.*;
import java.util.*;

public class Main {
    static String solve(List<String> lines) {
        // TODO: parse the input and compute the answer
        return "";
    }

    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        List<String> lines = new ArrayList<>();
        String line;
        while ((line = br.readLine()) != null) lines.add(line);
        System.out.println(solve(lines));
    }
}
`,
  cpp: `#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    // TODO: read the input from stdin and print the answer
    return 0;
}
`,
};

/* --------------------------- System design prompts -------------------------- */

export interface DesignPrompt {
  id: string;
  title: string;
  brief: string;
  tags: string[];
}

export const DESIGN_PROMPTS: DesignPrompt[] = [
  { id: "sd-url-shortener", title: "URL shortener at scale", brief: "Design a URL shortening service that handles 10k writes/s and 200k reads/s, with custom aliases, expiry and click analytics.", tags: ["backend", "general"] },
  { id: "sd-payment-retry", title: "Payment retry & reconciliation", brief: "Design a service that processes card payments via multiple gateways at 5k TPS, retries failures safely (no double charges) and reconciles daily with bank statements.", tags: ["fintech", "payments", "backend"] },
  { id: "sd-notifications", title: "Multi-channel notification system", brief: "Design a notification platform sending email, SMS and push to 50M users with per-user preferences, rate limits, templating and delivery tracking.", tags: ["backend", "general"] },
  { id: "sd-feed", title: "Activity feed", brief: "Design a social activity feed for 20M daily users showing posts from people they follow, with ranking and near-real-time updates.", tags: ["backend", "frontend", "general"] },
  { id: "sd-ci-pipeline", title: "CI/CD build platform", brief: "Design a CI/CD platform that runs 50k builds/day across many repositories with caching, isolation, and deployment gates.", tags: ["devops", "cloud"] },
  { id: "sd-analytics", title: "Event analytics pipeline", brief: "Design a pipeline that ingests 1M events/s from apps, supports real-time dashboards (1-minute freshness) and ad-hoc queries over 2 years of data.", tags: ["data", "analytics"] },
  { id: "sd-ride-matching", title: "Ride matching", brief: "Design the driver–rider matching service for a ride-hailing app in a city with 100k active drivers.", tags: ["backend", "general"] },
];

export const DESIGN_TEMPLATE = [
  { key: "requirements", label: "Requirements (functional & non-functional)" },
  { key: "components", label: "High-level components" },
  { key: "data", label: "Data model & storage" },
  { key: "apis", label: "Key APIs" },
  { key: "scaling", label: "Scaling & bottlenecks" },
  { key: "failures", label: "Failure handling" },
  { key: "tradeoffs", label: "Trade-offs" },
];

/* ------------------------------- Domain cases ------------------------------- */

export interface CaseExercise {
  id: string;
  title: string;
  brief: string;
  tags: string[];
  template: { key: string; label: string }[];
  minutes: number;
  tracks?: Track[];
  levels?: Seniority[];
}

const planTemplate = [
  { key: "understanding", label: "Understanding of the situation" },
  { key: "approach", label: "Approach / plan" },
  { key: "risks", label: "Risks & mitigations" },
  { key: "metrics", label: "How you would measure success" },
];

export const DOMAIN_CASES: CaseExercise[] = [
  { id: "dc-sales-price", title: "Price objection", brief: "A key account says your price is 20% above a competitor's and they will switch next quarter unless you match it. Outline how you would handle this account.", tags: ["sales", "business", "account"], template: planTemplate, minutes: 12 },
  { id: "dc-support-outage", title: "Public escalation", brief: "A large customer escalates an unresolved 6-hour outage publicly on social media and to your CEO. Draft your response and your plan for the next 48 hours.", tags: ["support", "customer", "success"], template: planTemplate, minutes: 12 },
  { id: "dc-hr-onboarding", title: "Campus onboarding", brief: "Design an onboarding plan for 50 campus hires joining in 6 weeks across 3 teams, with a limited budget.", tags: ["hr", "people", "talent", "recruit"], template: planTemplate, minutes: 12 },
  { id: "dc-ops-errors", title: "Order errors", brief: "Order-processing errors have risen to 4% of orders. Plan how you would reduce them by 30% within one quarter.", tags: ["operations", "ops", "process", "supply"], template: planTemplate, minutes: 12 },
  { id: "dc-marketing-launch", title: "Product launch", brief: "Plan the go-to-market for a new product feature aimed at small businesses with a budget of 20 lakh and 8 weeks.", tags: ["marketing", "growth", "brand"], template: planTemplate, minutes: 12 },
  { id: "dc-qa-release", title: "Release quality", brief: "The last two releases shipped with critical bugs found by customers. As the QA owner, propose how you would change the test strategy for the next release in 3 weeks.", tags: ["qa", "test", "quality"], template: planTemplate, minutes: 12 },
  { id: "dc-support-it", title: "IT incident triage", brief: "Ten employees report they cannot access email and VPN since this morning. Walk through how you would triage, communicate and resolve the incident.", tags: ["it", "support", "network", "admin"], template: planTemplate, minutes: 12 },
  { id: "dc-generic", title: "Prioritising competing requests", brief: "You receive five urgent requests from three stakeholders on the same day and can complete only two. Explain how you decide, communicate and follow up.", tags: ["general"], template: planTemplate, minutes: 10 },
];

/* ---------------------------- Managerial cases ------------------------------ */

export const MGMT_CASES: CaseExercise[] = [
  {
    id: "mc-recovery-plan",
    title: "Recovery plan",
    brief: "You have just taken over a team of 8 that has missed its last two releases. Two engineers resigned last month and morale is low. Product leadership wants a reliable delivery date for the next major release. Present a 30-60-90 day plan.",
    tags: ["delivery", "people"],
    tracks: ["manager"],
    minutes: 12,
    template: [
      { key: "diagnosis", label: "Diagnosis — what you'd look at first and why" },
      { key: "d30", label: "First 30 days" },
      { key: "d60", label: "Days 31–60" },
      { key: "d90", label: "Days 61–90" },
      { key: "risks", label: "Risks & mitigations" },
      { key: "metrics", label: "Metrics you'd track" },
      { key: "comms", label: "Stakeholder communication" },
    ],
  },
  {
    id: "mc-prioritise",
    title: "Prioritise with fixed headcount",
    brief: "Next quarter you have 6 engineers. Requests: (1) enterprise SSO for a large deal, (2) migrate off a deprecated database version (support ends in 5 months), (3) a redesign of onboarding that marketing wants, (4) fix flaky CI that costs ~6 engineer-hours/week, (5) a new analytics dashboard requested by the CEO, (6) reduce p95 latency of checkout by 40%, (7) GDPR data-export tooling (legal requirement in 4 months), (8) an internal hackathon week. Rank them, explain what you would drop or defer, and how you would communicate it.",
    tags: ["strategy", "prioritisation"],
    minutes: 12,
    template: [
      { key: "ranking", label: "Your ranking (top to bottom)" },
      { key: "rationale", label: "Rationale for the top 3 and bottom 3" },
      { key: "drop", label: "What you defer or drop, and the risk you accept" },
      { key: "comms", label: "How you communicate it to stakeholders" },
    ],
  },
  {
    id: "mc-migration-buyin",
    title: "Cross-team migration buy-in",
    brief: "You believe the monolith's order module must be extracted into a service to unblock scaling. Three teams depend on it and none have it on their roadmap. You have no authority over them. Write a proposal and an influence plan to get it done within two quarters.",
    tags: ["influence", "technical-leadership"],
    tracks: ["ic"],
    minutes: 12,
    template: [
      { key: "problem", label: "Problem statement & evidence" },
      { key: "proposal", label: "Proposal & phased plan" },
      { key: "influence", label: "Influence plan per team" },
      { key: "risks", label: "Risks & fallback" },
      { key: "success", label: "Definition of success" },
    ],
  },
  {
    id: "mc-incident-leadership",
    title: "Incident leadership",
    brief: "A deployment caused a 2-hour payments outage affecting 30% of customers on a sale day. You are the most senior engineer/manager on call. Describe how you run the incident, communicate during it, and what the post-mortem and follow-up look like.",
    tags: ["incident", "execution"],
    minutes: 12,
    template: [
      { key: "during", label: "During the incident" },
      { key: "comms", label: "Communication (internal & customer)" },
      { key: "postmortem", label: "Post-mortem process" },
      { key: "actions", label: "Follow-up actions & owners" },
    ],
  },
  {
    id: "mc-budget-cut",
    title: "Budget cut",
    brief: "Your department's budget for next year is cut by 20%. You lead 4 teams (32 people) and two strategic initiatives. Explain your plan, the trade-offs, and how you would communicate it.",
    tags: ["strategy", "org"],
    tracks: ["manager"],
    levels: ["director", "manager"],
    minutes: 12,
    template: [
      { key: "principles", label: "Decision principles" },
      { key: "plan", label: "Plan & trade-offs" },
      { key: "people", label: "People impact & how you handle it" },
      { key: "comms", label: "Communication plan" },
    ],
  },
];

/* ---------------------------- Situational scenarios ------------------------- */

export interface Scenario {
  id: string;
  text: string;
  competency: "leadership" | "stakeholder" | "execution" | "strategy" | "judgement";
  ethics: boolean;
  tracks: Track[];
}

export const SCENARIOS: Scenario[] = [
  { id: "sc-underperformer", text: "A well-liked engineer on your team has under-delivered for two months; peers are quietly picking up their work. What do you do?", competency: "leadership", ethics: false, tracks: ["manager"] },
  { id: "sc-promotion", text: "Your top performer asks for a promotion you can't justify yet and hints they have an offer elsewhere. How do you handle it?", competency: "leadership", ethics: false, tracks: ["manager"] },
  { id: "sc-junior-stuck", text: "A junior engineer you mentor has been stuck on a task for a week but keeps saying it's 'almost done'. What do you do?", competency: "leadership", ethics: false, tracks: ["ic"] },
  { id: "sc-conflicting-priorities", text: "Two senior stakeholders give your team conflicting top priorities for the same sprint and both say theirs is non-negotiable. What do you do?", competency: "stakeholder", ethics: false, tracks: ["ic", "manager"] },
  { id: "sc-design-disagreement", text: "In a design review, a respected principal engineer strongly pushes an approach you believe will not scale. The decision is due tomorrow. What do you do?", competency: "stakeholder", ethics: false, tracks: ["ic"] },
  { id: "sc-scope-creep", text: "Two weeks before launch, product adds three 'small' requirements that together will delay the launch by two weeks. How do you respond?", competency: "execution", ethics: false, tracks: ["ic", "manager"] },
  { id: "sc-team-conflict", text: "Two engineers on your team are in open conflict and it is affecting the rest of the team's work. How do you handle it?", competency: "judgement", ethics: false, tracks: ["manager", "ic"] },
  { id: "sc-ship-security", text: "Your director asks you to ship on Friday for a major customer demo, but you know there is an unpatched security vulnerability that could expose customer data. What do you do?", competency: "judgement", ethics: true, tracks: ["ic", "manager"] },
  { id: "sc-inflate-metrics", text: "Before a board review, your manager asks you to present a reliability metric in a way you believe is misleading. What do you do?", competency: "judgement", ethics: true, tracks: ["ic", "manager"] },
  { id: "sc-hiring-bias", text: "In a hiring debrief, a panelist argues against a strong candidate using reasons that seem unrelated to the job. How do you respond?", competency: "judgement", ethics: true, tracks: ["manager", "ic"] },
  { id: "sc-tech-debt", text: "Your team spends ~40% of its time on incidents caused by legacy code, but leadership only wants features this quarter. What do you do?", competency: "strategy", ethics: false, tracks: ["ic", "manager"] },
];

/* --------------------------- Section question banks ------------------------- */

/** Seed questions per round section. The interviewer adapts them to the candidate. */
export const SECTION_QUESTIONS: Record<string, string[]> = {
  "technical.intro": ["Walk me through your background and the work you're most proud of."],
  "technical.resume": [
    "Pick the project on your resume you're proudest of. What part did you personally build?",
    "Tell me about a significant technical decision you made. What alternatives did you consider?",
    "What's the hardest bug you've fixed? How did you find it?",
  ],
  "technical.github": ["Walk me through the architecture of this repository, starting from the entry point."],
  "technical.concepts": [],
  "technical.wrapup": ["Do you have any questions for us about the role or the team?"],
  "managerial.intro": ["Tell me about the largest team or initiative you've led. How was it structured and what did you own?"],
  "managerial.people": [
    "Tell me about someone on your team who was under-performing. What did you do and what happened?",
    "How have you helped someone on your team grow into a bigger role?",
    "Describe a hiring decision you got wrong. What did you learn?",
  ],
  "managerial.stakeholders": [
    "Describe a time you disagreed with your manager or product on a priority. How was it resolved?",
    "Tell me about a time you had to influence a team you had no authority over.",
  ],
  "managerial.execution": [
    "Tell me about a project that was going off track. How did you detect it and what did you change?",
    "How do you plan and track a multi-month initiative with several teams?",
  ],
  "managerial.strategy": [
    "How did you decide how much capacity to spend on tech debt versus features last year?",
    "Tell me about a decision you made with incomplete data. How did you approach it?",
  ],
  "managerial.wrapup": ["What questions do you have for us?"],
  "hr.intro": ["To start, how has your day been — and what do you know about this role so far?"],
  "hr.motivation": [
    "What made you apply for this role?",
    "Walk me through your career moves and what drove each one.",
    "Where do you want to be in three years, and how does this role help?",
  ],
  "hr.behavioral": [
    "Describe a time you received tough feedback. What did you do with it?",
    "Tell me about a time you had to adapt quickly to a big change at work.",
    "Tell me about a time you helped a teammate succeed.",
  ],
  "hr.wrapup": ["What would you like to know about working here?"],
};

export function domainCaseFor(category: RoleCategory, domain: string, title: string, exclude: string[]): CaseExercise {
  const text = `${domain} ${title}`.toLowerCase();
  const scored = DOMAIN_CASES.filter((c) => !exclude.includes(c.id))
    .map((c) => ({ c, s: c.tags.filter((t) => text.includes(t)).length }))
    .sort((a, b) => b.s - a.s);
  const best = scored[0];
  if (best && best.s > 0) return best.c;
  return category === "technical_non_coding" ? DOMAIN_CASES.find((c) => c.id === "dc-qa-release")! : DOMAIN_CASES.find((c) => c.id === "dc-generic")!;
}

export function designPromptFor(domain: string, skills: string[], exclude: string[]): DesignPrompt {
  const text = `${domain} ${skills.join(" ")}`.toLowerCase();
  const scored = DESIGN_PROMPTS.filter((d) => !exclude.includes(d.id))
    .map((d) => ({ d, s: d.tags.filter((t) => text.includes(t)).length + (d.tags.includes("general") ? 0.1 : 0) }))
    .sort((a, b) => b.s - a.s);
  return scored[0]?.d ?? DESIGN_PROMPTS[0];
}

export function mgmtCaseFor(track: Track, seniority: Seniority, exclude: string[]): CaseExercise {
  const pool = MGMT_CASES.filter(
    (c) => !exclude.includes(c.id) && (!c.tracks || c.tracks.includes(track)) && (!c.levels || c.levels.includes(seniority)),
  );
  return pool[0] ?? MGMT_CASES[3];
}

export function scenariosFor(track: Track): Scenario[] {
  return SCENARIOS.filter((s) => s.tracks.includes(track));
}
