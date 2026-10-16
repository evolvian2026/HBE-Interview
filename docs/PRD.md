# HBE Interview — Product Requirements Document

| | |
|---|---|
| **Product** | HBE Interview: an AI-powered, multi-round interview platform |
| **Document status** | v1.2 — approved by the product owner; Phase 1 built |
| **Date** | 2026-10-16 |
| **Owner** | Product Architect / Product Owner |
| **Companion documents** | [FEATURES.md](FEATURES.md) (detailed feature specification) · [ARCHITECTURE.md](ARCHITECTURE.md) (detailed technical architecture) |

### Revision history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-10-16 | Initial draft: resume parsing, GitHub validation, AI interview, live coding, scorecard |
| 1.2 | 2026-10-16 | Product owner decisions recorded (§11) and Phase 1 built: text + voice, Neon Postgres, Judge0, public repos, single internal organisation, HR always last, no compensation questions by default |
| 1.1 | 2026-10-16 | Added the **multi-round interview pipeline** with a **Managerial Round** (for senior and higher roles) and an **HR Round** (all roles). Added a seniority-based round matrix, round gating, round-level and combined scorecards, and detailed architecture and feature documents |

---

## 1. Summary

HBE Interview runs a complete, structured interview process for **any job role** without a human interviewer present. Depending on the role and seniority, a candidate goes through up to **three AI-conducted rounds**:

| Round | Who gets it | What it assesses |
|---|---|---|
| **1. Technical / Functional Round** | Every role | Resume deep-dive, **GitHub project validation**, role-specific concepts, **live coding** (coding roles), system design (senior technical roles), or domain case questions (non-technical roles) |
| **2. Managerial Round** | **Senior and higher roles** (Senior, Lead/Staff, Manager, Director); optional for Mid level | Leadership, people management, stakeholder management, execution and delivery, strategic thinking, situational judgement, and a written management case exercise |
| **3. HR Round** | Every role | Motivation, culture and values alignment, behavioral competencies (STAR), career goals, professional conduct, and practical fit (notice period, compensation expectations, location, joining date) |

After each round, the platform produces an **evidence-backed round scorecard**. At the end of the pipeline it produces a **combined candidate report** that recruiters can trust, compare, and audit.

### 1.1 Problem

- First-round technical screens use a lot of senior engineers' time, are inconsistent between interviewers, and are hard to schedule. Managerial and HR rounds are also inconsistent and depend on the interviewer's mood, style, and bias.
- Resumes are increasingly inflated or AI-written, and projects are copied, forked, or built from tutorials. Recruiters can't check this at scale.
- Async coding tests measure puzzle solving. They miss communication, depth of understanding, leadership ability, and culture fit.
- For senior hires, recruiters need signal on **leadership and judgement**, not only technical skill, and a structured view of **practical fit** (notice period, compensation, location) before investing panel time.

### 1.2 Vision

> "A structured, fair, senior-interviewer-quality interview process (technical, managerial and HR) available 24×7 for every applicant, where every score is backed by evidence."

### 1.3 Goals (MVP)

| # | Goal | Measure of success |
|---|---|---|
| G1 | Run an end-to-end automated multi-round interview for any role | ≥ 95% of started rounds reach a generated round report |
| G2 | Verify that resume projects are authentic | Every linked repo gets an authenticity analysis plus ≥ 2 repo-grounded questions |
| G3 | Assess coding ability where relevant | Coding roles include ≥ 1 live coding task that is executed against test cases |
| G4 | Assess leadership for senior roles | Senior+ candidates complete a Managerial Round with ≥ 4 leadership competencies evidenced |
| G5 | Assess motivation, culture fit, and practical fit for all roles | Every completed pipeline includes an HR scorecard and a practical-fit summary |
| G6 | Produce trustworthy, explainable evaluation | Every score cites transcript/code evidence; recruiter-AI agreement ≥ 80% in pilot |
| G7 | Cut recruiter and panel effort | ≥ 70% less human time per candidate before the final human round |

### 1.4 Non-goals (MVP)

- Replacing the final hiring decision. AI output is **advisory**, and a human decides.
- Offer generation, salary negotiation, or background verification.
- Full video proctoring with face or identity verification (Phase 3).
- ATS / HRMS integrations (Phase 2).
- Panel or group interviews; native mobile apps (responsive web only, and coding requires a desktop or laptop).

---

## 2. Personas

| Persona | Description | Primary needs |
|---|---|---|
| **Candidate** | Job applicant, from fresher to director, technical or non-technical | Clear instructions, knowing which rounds to expect, a fair and stable experience, a working code editor |
| **Recruiter / HR Business Partner** | Creates hiring drives and manages candidates through rounds | Quick setup, round configuration, gating control, ranked candidate lists, practical-fit visibility |
| **Hiring Manager** | Owns the role and makes the hire decision | Trustworthy technical and managerial assessment, focus areas for the final human round |
| **Org Admin** | Manages the organization account | Users and roles, company values, HR policy knowledge base, rubric defaults, data retention |
| **Platform Super-Admin** (internal) | HBE operations | Tenants, prompt/model configuration, monitoring, cost control |

---

## 3. Core concepts

| Concept | Definition |
|---|---|
| **Hiring Drive** (Interview Template) | A configured interview process for one role: JD, role profile, seniority, round pipeline, rubrics, and settings |
| **Seniority level** | One of: Intern/Fresher · Junior (0–2 yrs) · Mid (2–5) · Senior (5–8) · Lead/Staff/Principal (8+, individual contributor) · Manager · Senior Manager/Director |
| **Role category** | Coding · Technical non-coding (e.g. QA manual, solution architect, IT support) · Non-technical (e.g. sales, HR, operations) |
| **Track** | Individual Contributor (IC) or People Manager. It affects Managerial Round content and weights |
| **Round** | One AI-conducted interview session of a given type (Technical/Functional, Managerial, HR), with its own sections, duration, and scorecard |
| **Round pipeline** | The ordered list of rounds for a drive, plus the **gating rules** between them |
| **Gate** | The rule that decides whether a candidate moves to the next round: auto-advance on score threshold, recruiter decision, or always advance |
| **Round scorecard** | Parameter scores, evidence, and recommendation for one round |
| **Combined report** | Weighted combination of all round scorecards plus a final recommendation |

### 3.1 Round matrix by seniority (defaults, configurable per drive)

| Seniority | Technical / Functional | Managerial | HR | Default round weights (Tech / Mgr / HR) |
|---|---|---|---|---|
| Intern / Fresher | ✅ (fundamentals-heavy; projects instead of experience) | — | ✅ | 75 / – / 25 |
| Junior (0–2) | ✅ | — | ✅ | 75 / – / 25 |
| Mid (2–5) | ✅ | Optional (light) | ✅ | 70 / – / 30 (65 / 15 / 20 if Managerial enabled) |
| Senior (5–8) | ✅ (+ system design for technical roles) | ✅ (IC track: technical leadership, mentoring, influence) | ✅ | 55 / 25 / 20 |
| Lead / Staff / Principal (IC) | ✅ (system design-heavy; coding lighter) | ✅ (IC track) | ✅ | 50 / 30 / 20 |
| Manager | ✅ (architecture and technical judgement; coding optional) | ✅ (People Manager track, full) | ✅ | 35 / 45 / 20 |
| Senior Manager / Director | ✅ (strategy-level technical/functional depth; no coding) | ✅ (People Manager track, strategic) | ✅ | 25 / 55 / 20 |

### 3.2 Round sequencing and gating

- **Default order:** Technical/Functional → Managerial → HR. The recruiter can reorder rounds, for example to run HR first as a screen for high-volume roles.
- **Scheduling modes:**
  - **Staged (default):** each round is a separate session. The candidate is invited to the next round when they pass the gate, and can take it immediately or within an expiry window (default 7 days).
  - **Single sitting:** all rounds run back to back with optional breaks of up to 10 min. Use this for campus drives or walk-ins.
- **Gate rules (per transition):**
  - **Auto-advance** if the round recommendation is ≥ a threshold (default: "Hire"). Below the threshold, the candidate goes to the recruiter for a decision.
  - **Manual:** the recruiter decides every transition.
  - **Always advance:** every candidate completes all rounds (useful for benchmarking).
- **Context carry-over:** later rounds receive a **summary of earlier rounds** (strengths, concerns, focus areas, practical facts) so the AI does not repeat questions and can probe open concerns. Later rounds **do not receive earlier scores**, to avoid anchoring bias in evaluation.

---

## 4. End-to-end user journeys

### 4.1 Recruiter: create a hiring drive

1. Select **New Hiring Drive**. Enter the role title and paste or upload the JD.
2. The AI suggests the role category, seniority, track (IC or Manager), skills matrix, **round pipeline** (from the §3.1 matrix), sections per round, durations, coding languages, and rubric weights.
3. The recruiter adjusts the rounds: enable/disable, reorder, set gates, set durations, pin custom questions per round, and set a **practical-fit band** for the HR round (budget compensation range, maximum notice period, locations, work model).
4. Save and publish. Generate an invite link or bulk-invite candidates by CSV.
5. Track progress on the drive pipeline board: Invited → Round 1 → Round 2 → Round 3 → Completed → Decision.

### 4.2 Candidate: take the interview process

```
Invite ─► Sign-in (email OTP) ─► Consent ─► Overview of rounds ─► System check
  ─► Upload resume ─► Confirm parsed profile ─► Link GitHub repos (technical roles)
  ─► ROUND 1: Technical / Functional
        Intro · Resume deep-dive · GitHub validation · Concepts · Live coding / System design / Case · Wrap-up
  ─► [Gate] ─► invitation to next round (staged) or short break (single sitting)
  ─► ROUND 2: Managerial (senior+ roles)
        Intro · Leadership & people · Stakeholders & influence · Execution & delivery
        · Strategic thinking · Situational scenarios · Written case exercise · Wrap-up
  ─► [Gate]
  ─► ROUND 3: HR
        Intro · Motivation & career story · Values & culture · Behavioral (STAR)
        · Practical fit (notice, compensation expectation, location, joining) · Policy Q&A · Close
  ─► Completion confirmation ─► (optional) feedback survey
```

### 4.3 Recruiter / Hiring Manager: review outcomes

1. Open a candidate and see the **Combined Report**: final score, recommendation, a strip of round scores, and practical-fit status.
2. Drill into each **Round Scorecard**: parameter scores, evidence, transcript, code, repo analysis, managerial case response, and integrity signals.
3. Act on gates (advance / hold / reject), override scores with a reason, add notes.
4. Shortlist for the final human round, using the AI-generated **focus areas for the human panel**.
5. Compare candidates side by side; export PDF.

---

## 5. Functional requirements (summary)

Priority: **P0** = MVP must-have, **P1** = MVP should-have, **P2** = later phase. The full behavior, UI, business rules, acceptance criteria, and edge cases of every requirement are in **[FEATURES.md](FEATURES.md)**.

### 5.1 Module A — Hiring drive & template setup

| ID | Requirement | Priority |
|---|---|---|
| A-1 | Create a drive from a role title plus JD text or file | P0 |
| A-2 | AI parses the JD into a role profile: category, seniority, track, must/nice skills, responsibilities, leadership expectations | P0 |
| A-3 | The role category drives the Technical/Functional round structure (Coding / Technical non-coding / Non-technical) | P0 |
| A-4 | The seniority and track drive the **default round pipeline** (§3.1) | P0 |
| A-5 | Configurable sections per round: on/off, time budget, min/max questions | P0 |
| A-6 | Configurable rubric weights per round, and round weights in the combined score (each must total 100%) | P0 |
| A-7 | Coding languages and difficulty selection | P0 |
| A-8 | Pinned custom questions per round, and a custom coding problem with test cases | P1 |
| A-9 | Template library with prebuilt drives for common roles (SDE, Frontend, Data Analyst, DevOps, Engineering Manager, Sales, Support, HR Executive) | P1 |
| A-10 | Interview language selection beyond English | P2 |

### 5.2 Module B — Candidate onboarding & invites

| ID | Requirement | Priority |
|---|---|---|
| B-1 | Invite links (open or per-candidate tokens with expiry) | P0 |
| B-2 | Bulk invite via CSV with email delivery and reminders | P1 |
| B-3 | Passwordless candidate auth (email OTP / magic link) | P0 |
| B-4 | Consent screen covering AI evaluation, data use, recording, and retention | P0 |
| B-5 | Rounds overview screen (which rounds, durations, what is assessed) | P0 |
| B-6 | System check (browser, screen size for coding, network) | P0 |
| B-7 | Allowed attempts per round (default 1) and resume-after-disconnect | P0 |

### 5.3 Module C — Resume parsing & analysis

| ID | Requirement | Priority |
|---|---|---|
| C-1 | Upload PDF or DOCX (≤ 5 MB); image-only PDFs rejected (OCR in P2) | P0 |
| C-2 | Extract a structured profile: skills (normalized), experience, projects, education, certifications, **leadership experience** (team sizes managed, scope, reports) | P0 |
| C-3 | Candidate confirms or edits the parsed profile; edits are logged | P0 |
| C-4 | Resume–JD match: matched/missing must-have skills, relevance, seniority fit | P0 |
| C-5 | Generate **claims to probe**, tagged by round: technical claims go to Round 1, leadership claims ("led a team of 8") go to the Managerial Round, career claims go to HR | P0 |
| C-6 | Resume risk signals (gaps, overlaps, skill-stuffing, vague projects) | P1 |
| C-7 | Auto-detect GitHub/portfolio links | P0 |

### 5.4 Module D — GitHub project validation (Technical Round)

| ID | Requirement | Priority |
|---|---|---|
| D-1 | Candidate links a repo per project, or marks it not public with a reason | P0 |
| D-2 | Candidate GitHub username for commit attribution | P0 |
| D-3 | Public repos via the GitHub API; private repos via GitHub OAuth (read-only) | P0 / P1 |
| D-4 | Repo ingestion: metadata, tree, README, manifests, sampled key files within size/token budgets | P0 |
| D-5 | Authenticity signals: fork status, candidate commit share, history depth and spread, tech match, boilerplate similarity, activity timeline | P0 |
| D-6 | Code understanding summary: architecture, components, design decisions, quality observations | P0 |
| D-7 | ≥ 3 targeted questions per repo grounded in specific files, functions, and decisions | P0 |
| D-8 | Asynchronous analysis; the GitHub section is scheduled after the resume section | P0 |
| D-9 | Graceful handling of empty or huge repos, monorepos, rate limits, and unreachable repos | P0 |
| D-10 | GitLab / Bitbucket / portfolio sources | P2 |

> **Principle:** Authenticity signals are **indicators, never verdicts**. The authenticity score depends mainly on **how well the candidate explains their own code**.

### 5.5 Module E — AI interview engine (shared by all rounds)

| ID | Requirement | Priority |
|---|---|---|
| E-1 | Chat-style interview UI with streaming AI messages | P0 |
| E-2 | Voice mode (TTS questions, STT answers with a live, editable transcript), especially valuable for HR and Managerial rounds | P0 (approved, §11) |
| E-3 | Server-side section state machine per round, with timers and a progress bar | P0 |
| E-4 | Adaptive questioning: follow-ups on shallow answers, difficulty escalation on strong ones, move on after 2 weak follow-ups | P0 |
| E-5 | Question sources: claims, repo questions, skills matrix, competency library, org values, pinned questions | P0 |
| E-6 | Coverage tracking of skills, competencies, and claims per round | P0 |
| E-7 | Hidden per-answer micro-evaluations | P0 |
| E-8 | **Round-specific interviewer persona**: Technical Interviewer (peer engineer), Hiring Manager persona (Managerial), HR Partner persona (HR). All are professional and neutral, and never reveal scores | P0 |
| E-9 | Guardrails: off-topic refusal, prompt-injection resistance, **no questions on protected characteristics** (enforced most strictly in HR) | P0 |
| E-10 | Candidate controls: repeat/clarify, skip (logged), "I need a moment" pause | P0 |
| E-11 | Session persistence and resume within 15 min of a disconnect | P0 |
| E-12 | Round duration configurable at 15–90 min; graceful time-up wrap-up | P0 |
| E-13 | Candidate questions at wrap-up, answered from the JD and the org knowledge base | P1 (P0 in the HR round) |

### 5.6 Module F — Live coding & technical exercises (Technical Round)

| ID | Requirement | Priority |
|---|---|---|
| F-1 | Monaco editor with language templates | P0 |
| F-2 | Python, JavaScript/TypeScript, Java, C++ (Go and SQL in P1) | P0 |
| F-3 | Curated, pre-validated problem bank plus AI-adapted variants validated against a reference solution | P0 |
| F-4 | Run (sample tests) and Submit (hidden tests) in an isolated sandbox | P0 |
| F-5 | The AI sees the editor: asks about approach, complexity, edge cases; gives graded hints (recorded) | P0 |
| F-6 | Code snapshots and replay | P1 |
| F-7 | Paste detection (integrity signal) | P0 |
| F-8 | Inline mini-editor for snippets in other sections | P1 |
| F-9 | **System design section** for Senior+ technical roles: a structured written design (requirements, components, data, scaling, trade-offs) with AI probing | P0 |
| F-10 | Whiteboard/diagram canvas for system design | P2 |
| F-11 | **Domain case section** for non-technical roles: a written case response (e.g. a sales objection-handling plan) | P0 |

### 5.7 Module G — Managerial Round *(new in v1.1)*

| ID | Requirement | Priority |
|---|---|---|
| G-1 | The Managerial Round is enabled by default for Senior, Lead/Staff, Manager, and Director levels, and optional for Mid | P0 |
| G-2 | Two tracks: **IC track** (technical leadership, mentoring, cross-team influence, driving decisions without authority) and **People Manager track** (team building, hiring, performance management, delivery, stakeholder and org leadership) | P0 |
| G-3 | Sections: Intro & leadership story · People leadership · Stakeholder management & influence · Execution & delivery · Strategic thinking & decision-making · Situational judgement scenarios · Written case exercise · Wrap-up | P0 |
| G-4 | Competency library with behavioral and situational question banks per competency and seniority. The AI adapts questions to the candidate's resume (leadership claims from C-5) and to the domain of the JD | P0 |
| G-5 | **Behavioral probing using STAR**: the AI checks each answer for Situation, Task, Action, and Result. It asks follow-ups for missing elements, the candidate's personal contribution ("what did *you* do?"), measurable outcomes, and learnings | P0 |
| G-6 | **Situational judgement scenarios**: realistic dilemmas (underperformer, conflicting priorities, missed deadline, team conflict, ethics concern, scope creep), adapted to seniority. The AI probes reasoning and trade-offs | P0 |
| G-7 | **Written case exercise** in a structured response panel (10–15 min). Examples: "Your team has missed two releases; present a 30-60-90 day recovery plan", "Prioritize these 8 initiatives with a fixed headcount and justify". The AI then discusses the response | P0 |
| G-8 | Prioritization exercise with drag-and-drop ranking plus rationale | P1 |
| G-9 | Carries over the Technical Round summary (e.g. "strong on design, weak on testing practices") to probe how the candidate leads teams in those areas | P0 |
| G-10 | Managerial scorecard (§6.2) with evidence | P0 |

### 5.8 Module H — HR Round *(new in v1.1)*

| ID | Requirement | Priority |
|---|---|---|
| H-1 | The HR Round is enabled by default for all roles and seniorities | P0 |
| H-2 | Sections: Intro · Motivation & career story · Values & culture alignment · Behavioral competencies (STAR) · Practical fit · Policy Q&A · Close | P0 |
| H-3 | **Org values**: the Org Admin defines company values (name, description, observable behaviors). The AI asks value-based behavioral questions and maps evidence to each value | P0 |
| H-4 | Behavioral competencies assessed: teamwork, ownership, adaptability, handling feedback, conflict handling, learning agility, integrity (scenario-based) | P0 |
| H-5 | **Practical fit capture** (structured, confirmed by the candidate): current location and willingness to relocate, preferred work model, notice period and earliest joining date, **expected** compensation (range), current-offer status (optional), and work authorization where relevant | P0 |
| H-6 | **Salary history is not asked by default** (it is illegal in several jurisdictions). Asking current compensation is an org-level setting that is off by default and shows a jurisdiction warning | P0 |
| H-7 | Practical-fit **compatibility check** against the drive's configured band (budget range, max notice period, locations, work model), shown as Match / Negotiable / Mismatch. **This is not part of the competency score** | P0 |
| H-8 | **Policy Q&A**: the candidate can ask about leave, benefits, work model, probation, and similar topics. The AI answers **only** from the org's HR knowledge base (uploaded documents/FAQ) and otherwise says HR will follow up. Unanswered questions are logged for the recruiter | P0 |
| H-9 | **Strict compliance guardrails**: the AI never asks about or records age, marital status, pregnancy or family plans, religion, caste, ethnicity, health or disability, sexual orientation, political views, or union membership. If the candidate volunteers such information, it is excluded from evaluation and redacted from the evaluator's input | P0 |
| H-10 | HR scorecard (§6.3) with evidence, plus the practical-fit summary | P0 |
| H-11 | Red-flag detection (for recruiter attention only): inconsistencies between the resume and HR answers (dates, reasons for leaving, titles) and unprofessional conduct | P1 |

### 5.9 Module I — Scoring, evaluation & reports

| ID | Requirement | Priority |
|---|---|---|
| I-1 | A round evaluation pipeline runs at the end of each round | P0 |
| I-2 | Each round parameter is scored on a 1–5 anchored scale with justification and ≥ 2 evidence items | P0 |
| I-3 | Round score 0–100, round recommendation, and evaluation confidence | P0 |
| I-4 | **Combined report** at pipeline completion (or on demand with partial rounds): weighted final score, final recommendation, strengths, concerns, practical fit, and focus areas for the human panel | P0 |
| I-5 | Consistency controls: low temperature, schema-validated JSON, 2 runs plus a tiebreak, median | P0 |
| I-6 | Evidence verification: every quoted evidence item is checked server-side against the actual transcript or code; unverifiable items are dropped and the run is retried | P0 |
| I-7 | Recruiter override per parameter with a mandatory reason; audit trail kept | P0 |
| I-8 | PDF export and a shareable expiring link | P1 |
| I-9 | Candidate-facing feedback summary (optional) | P2 |
| I-10 | Round report within 3 minutes (p95) | P0 |

### 5.10 Module J — Recruiter dashboard & pipeline management

| ID | Requirement | Priority |
|---|---|---|
| J-1 | Drives list with funnel counts per round | P0 |
| J-2 | **Pipeline board** per drive: columns by stage (Invited, Round 1, Round 2, Round 3, Completed, Shortlisted, Rejected) | P0 |
| J-3 | Candidate table sortable by final, round, and parameter scores; filters for recommendation, practical-fit status, and integrity flags | P0 |
| J-4 | **Gate actions** queue: candidates awaiting a recruiter decision between rounds | P0 |
| J-5 | Candidate detail with the combined report and round tabs | P0 |
| J-6 | Side-by-side comparison of up to 4 candidates | P1 |
| J-7 | Analytics: funnel conversion per round, drop-off by section, score distributions, average time-to-complete | P1 |

### 5.11 Module K — Integrity & fairness

| ID | Requirement | Priority |
|---|---|---|
| K-1 | Browser signals: focus loss, copy/paste, fullscreen exit, abnormal answer timing | P0 |
| K-2 | Signals shown as context with a concern level, **never auto-penalized** | P0 |
| K-3 | Likely AI-generated or read-out answer detection (flag only) | P1 |
| K-4 | PII and protected-attribute masking in evaluator input | P0 |
| K-5 | Cross-round consistency check: contradictions between rounds, flagged for the recruiter | P1 |
| K-6 | Bias audits across cohorts | P2 |
| K-7 | Webcam snapshots / identity verification | P2 |

### 5.12 Module L — Administration & platform

| ID | Requirement | Priority |
|---|---|---|
| L-1 | Multi-tenant organizations; roles: Org Admin, Recruiter, Hiring Manager, Viewer | P0 |
| L-2 | Org settings: retention period, rubric defaults, **company values**, **HR knowledge base**, compensation-question policy, branding (logo, colors) | P0 |
| L-3 | Usage metering: rounds run, AI cost per round | P1 |
| L-4 | Super-admin prompt/model registry with versioning; reports stamped with versions | P1 |

---

## 6. Evaluation framework

All parameters use the same anchored 1–5 scale:

| Score | Label | General anchor |
|---|---|---|
| 5 | Exceptional | Exceeds expectations for the seniority; deep, precise, insightful; no material gaps |
| 4 | Strong | Fully meets expectations; minor gaps only |
| 3 | Adequate | Meets core expectations with noticeable gaps; needed prompting |
| 2 | Weak | Significant gaps; superficial or partially incorrect |
| 1 | Insufficient | Could not demonstrate the competency, or evidence contradicts claims |
| N/A | Not assessed | Insufficient evidence; the weight is redistributed and confidence is lowered |

**Round score** = Σ (parameter score ÷ 5 × parameter weight), giving 0–100.
**Recommendation bands** (all rounds and combined, configurable): **Strong Hire ≥ 80 · Hire 65–79 · Lean No 50–64 · No Hire < 50**.

Parameter-specific anchors (what a 1, 3, and 5 look like for each parameter) are defined in [FEATURES.md §10](FEATURES.md#10-evaluation--scoring).

### 6.1 Technical / Functional Round parameters

| Parameter | Measures | Coding | Tech non-coding | Non-tech |
|---|---|---|---|---|
| Role Fit | Demonstrated skills, depth, and seniority vs JD | 25% | 30% | 35% |
| Resume & Project Authenticity | Did they do what they claim, and can they explain it in depth | 20% | 25% | 20% |
| Code Quality | Correctness, readability, structure, edge cases, testing mindset | 20% | 5% | 0% |
| Problem-Solving | Decomposition, reasoning, trade-offs, complexity, use of hints | 20% | 25% | 30% |
| Communication Clarity | Structured, accurate, concise explanations | 15% | 15% | 15% |

For Senior+ technical roles, the system design discussion contributes to Problem-Solving and Role Fit. Knockout: Authenticity ≤ 2 caps the round recommendation at "Lean No".

### 6.2 Managerial Round parameters *(new)*

| Parameter | Measures | IC track | People Manager track |
|---|---|---|---|
| Leadership & People Development | Mentoring, building teams, feedback, handling underperformance, hiring (Manager track), raising the bar (IC track) | 20% | 25% |
| Stakeholder Management & Influence | Managing up and across, negotiation, influencing without authority, communicating with non-technical stakeholders | 25% | 20% |
| Execution & Delivery Ownership | Planning, prioritization, risk management, accountability for outcomes, recovering failing projects | 20% | 20% |
| Strategic Thinking & Decision-Making | Long-term thinking, trade-off reasoning, data-informed decisions, aligning work to business goals | 20% | 20% |
| Situational Judgement & Conflict Resolution | Quality of reasoning in dilemmas, fairness, ethics, de-escalation | 15% | 15% |

Inputs: behavioral answers (STAR completeness and personal ownership), situational scenarios, the written case exercise, and the consistency of leadership claims with the resume. Knockout: Situational Judgement = 1 on an ethics scenario caps the round recommendation at "Lean No".

### 6.3 HR Round parameters *(new)*

| Parameter | Measures | Weight |
|---|---|---|
| Motivation & Role Interest | Genuine, specific reasons for the role and company; understanding of the role | 20% |
| Culture & Values Alignment | Behavioral evidence matching the org's configured values | 25% |
| Behavioral Competencies | Teamwork, ownership, adaptability, handling feedback, learning agility (STAR evidence) | 25% |
| Career Goals Alignment | Coherence of career story; alignment of the role with stated goals and growth path | 15% |
| Professional Communication & Conduct | Clarity, professionalism, respect, honesty and consistency of answers | 15% |

**Practical Fit** (notice period, compensation expectation, location, work model, joining date) is reported as a **Match / Negotiable / Mismatch** compatibility panel. It is **not scored**, so logistics are not confused with competence. The recruiter sees it next to the scores.

### 6.4 Combined score & final recommendation

- **Final score** = Σ (round score × round weight), using the seniority defaults in §3.1, renormalized over the rounds that were actually completed.
- **Final recommendation** = the band of the final score, with these rules:
  - Any round's knockout applies to the final recommendation.
  - Any round with "No Hire" caps the final recommendation at "Lean No" unless a recruiter overrides it.
  - If not all configured rounds are complete, the report is marked **Partial** and confidence is lowered.
- The report adds **Focus areas for the human panel**: 3–5 specific topics to verify in the final human interview, drawn from low-confidence or borderline parameters.

---

## 7. AI system overview

| Stage | Purpose | Model tier |
|---|---|---|
| JD Analyzer | JD → role profile, seniority, track, skills, round pipeline | Claude Sonnet 5.5 |
| Resume Parser | Resume → profile, claims tagged by round, JD match | Claude Sonnet 5.5 |
| Repo Analyzer | Repo → summary, authenticity signals, grounded questions | Claude Sonnet 5.5 (Opus 5.5 for large repos) |
| Interviewer Agents | Technical, Managerial, and HR personas conducting turn-by-turn interviews with tool use | Claude Sonnet 5.5 |
| Exercise Generator | Coding problems, system design prompts, managerial cases, situational scenarios | Claude Sonnet 5.5 + curated banks |
| Round Evaluator | Round scorecard with verified evidence | Claude Opus 5.5 |
| Report Synthesizer | Combined report, focus areas, cross-round consistency | Claude Opus 5.5 |
| Utility tasks | Summaries, classification, PII redaction assist, integrity text analysis | Claude Haiku 5.5 |

The server, not the LLM, owns interview state. Every stage uses schema-validated structured output, and all prompts and models are versioned. Full design: [ARCHITECTURE.md §7–§9](ARCHITECTURE.md).

**Responsible AI:** PII and protected-attribute masking; evidence-required scoring; no questions on protected characteristics; transparent disclosure to candidates; advisory-only recommendations with human override; a reproducible audit trail.

---

## 8. Non-functional requirements

| Area | Requirement |
|---|---|
| **Latency** | Interviewer first token ≤ 2 s p95; code run ≤ 5 s p95; resume parse ≤ 20 s; repo analysis ≤ 3 min p95; round report ≤ 3 min p95; combined report ≤ 2 min after the last round report |
| **Scale (MVP)** | 200 concurrent round sessions; 10k rounds/month |
| **Availability** | 99.5% monthly for candidate flows; pause-and-resume on AI provider failure |
| **Security** | TLS; encryption at rest; tenant row-level security; signed URLs; isolated code sandbox; OWASP Top-10; secrets server-side only |
| **Privacy & compliance** | Consent; data minimization; retention with automatic deletion; candidate export/delete; designed for India's **DPDP Act 2023** and **GDPR**; no protected-attribute processing; configurable AI-hiring disclosure notices; salary-history question off by default |
| **Accessibility** | WCAG 2.1 AA for candidate flows; extra-time accommodation per candidate |
| **Browsers** | Latest 2 versions of Chrome, Edge, Firefox, and Safari; desktop required for coding |
| **Observability** | Traces per session, AI cost/latency per stage, alerting |
| **Cost** | Targets: ≤ US$1.50 per 45-min technical round, ≤ US$0.80 per Managerial or HR round |

---

## 9. Technical architecture (summary)

- **Frontend + API:** Next.js (App Router, TypeScript), Tailwind + shadcn/ui, Monaco editor, hosted on **Render**.
- **Data:** **Neon Postgres** (resumes stored in the database); built-in staff auth and candidate personal links.
- **Async jobs:** a Postgres-backed job queue processed in the web process (or a separate Render worker), used for resume parsing, repo analysis, evaluation, and reports.
- **AI:** Anthropic Claude API (Sonnet / Opus / Haiku tiers) with tool use, structured outputs, and prompt caching.
- **Code execution:** Judge0 sandbox now; AWS-hosted sandbox later.
- **Integrations:** GitHub REST API, an email provider (Resend/SendGrid).

Diagrams, component design, the interview state machine, data model, API specification, security, deployment, and testing strategy are in **[ARCHITECTURE.md](ARCHITECTURE.md)**.

---

## 10. Release plan

| Phase | Scope |
|---|---|
| **Phase 1 — MVP** | All P0 items: drives with the round pipeline, onboarding, resume parsing, public GitHub validation, Technical Round with live coding and system design, **Managerial Round** with written case, **HR Round** with practical fit and policy Q&A, round and combined reports, gating, dashboard and pipeline board, integrity signals, PII masking |
| **Phase 2** | P1 items: voice mode, private repos, bulk invites and reminders, code replay, prioritization exercise, PDF export, comparison, analytics, template library, cross-round consistency checks, prompt/model admin |
| **Phase 3** | P2 items: multilingual interviews, OCR, whiteboard, other git hosts, proctoring and identity verification, ATS/HRMS integrations, candidate feedback, bias audits |

### 10.1 Phase 1 build milestones

1. **M1 Foundations**: scaffold, Neon Postgres schema and migrations, auth, Render deploy pipeline.
2. **M2 Drives & round pipeline**: JD analysis, round matrix, section/rubric/gate editor, org values and HR knowledge base, invites.
3. **M3 Resume pipeline**: upload, parse, confirm, JD match, round-tagged claims.
4. **M4 GitHub pipeline**: ingestion, authenticity signals, grounded questions.
5. **M5 Interview engine**: shared orchestrator, state machine, interviewer agents for the three personas, session resume.
6. **M6 Technical exercises**: Monaco, problem bank, sandbox, system design panel, domain case panel.
7. **M7 Managerial & HR specifics**: competency banks, STAR probing, scenarios, written case, practical fit, policy Q&A, compliance guardrails.
8. **M8 Evaluation & reports**: round evaluators, evidence verification, combined report, gates, overrides.
9. **M9 Dashboard, integrity, hardening**: pipeline board, gate queue, integrity panel, security review, load test, pilot.

---

## 11. Product owner decisions (approved 2026-10-16)

| # | Topic | Decision |
|---|---|---|
| 1 | Interview modality | **Text and voice** in the MVP (voice via the browser Web Speech API; transcripts are editable and evaluated) |
| 2 | Tech stack | Next.js + Render + Claude API + Judge0, with **Neon Postgres** instead of Supabase |
| 3 | Code execution | **Judge0** now; migrate to an AWS-hosted sandbox later (executor is pluggable) |
| 4 | Repositories | **Public GitHub repositories only** |
| 5 | Rubrics | Approved as written (§6), including knockouts and bands |
| 6 | Round order | **Technical → Managerial (if applicable) → HR last**; staged mode with auto-advance at "Hire" as the default |
| 7 | Compensation | Skipped: the HR round does not ask about compensation by default (org-level toggle available; salary history never asked) |
| 8 | Tenancy | **Single internal tool now**; multi-tenant later |
| 9 | Branding | Keep **"HBE Interview"** |
| 10 | Scope | **Full working version** of all P0 modules |

---

*Once approved, this document becomes the baseline spec. Changes after approval will be tracked in the revision history.*
