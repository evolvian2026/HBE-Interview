# HBE Interview — Feature Specification

| | |
|---|---|
| **Document status** | v1.9 — approved; Phases 1–8 built (as-built notes: ARCHITECTURE §0; integration reference: [API.md](API.md)) |
| **Date** | 2026-10-16 |
| **Related** | [PRD.md](PRD.md) (product requirements) · [ARCHITECTURE.md](ARCHITECTURE.md) (technical architecture) |

This document specifies **how each feature behaves**: user stories, flows, screens, business rules, data captured, acceptance criteria, and edge cases. Requirement IDs (e.g. `A-2`, `G-5`) refer to the PRD.

---

## Contents

1. [Conventions, roles & permissions](#1-conventions-roles--permissions)
2. [Screen inventory & navigation](#2-screen-inventory--navigation)
3. [Hiring drive & round pipeline setup](#3-hiring-drive--round-pipeline-setup)
4. [Candidate onboarding](#4-candidate-onboarding)
5. [Resume parsing & analysis](#5-resume-parsing--analysis)
6. [Shared interview engine](#6-shared-interview-engine)
7. [Technical / Functional Round](#7-technical--functional-round)
8. [Managerial Round](#8-managerial-round)
9. [HR Round](#9-hr-round)
10. [Evaluation & scoring](#10-evaluation--scoring)
11. [Reports](#11-reports)
12. [Recruiter dashboard & pipeline management](#12-recruiter-dashboard--pipeline-management)
13. [Integrity & fairness](#13-integrity--fairness)
14. [Administration & org settings](#14-administration--org-settings)
15. [Notifications](#15-notifications)
16. [Global error states & edge cases](#16-global-error-states--edge-cases)
17. [Phase 2 features (v1.3)](#17-phase-2-features-v13)
18. [Phase 3 features (v1.4)](#18-phase-3-features-v14)
19. [Phase 4 features (v1.5)](#19-phase-4-features-v15)
20. [Phase 5 features (v1.6)](#20-phase-5-features-v16)
21. [Phase 6 features (v1.7)](#21-phase-6-features-v17)
22. [Phase 7 features (v1.8)](#22-phase-7-features-v18)
23. [Phase 8 features (v1.9)](#23-phase-8-features-v19)

---

## 1. Conventions, roles & permissions

### 1.1 Format of each feature

Each feature has a **Purpose**, **User stories**, **Behavior** (flow and rules), **UI**, **Data captured**, **Acceptance criteria (AC)**, and **Edge cases**, where relevant.

### 1.2 Roles

| Role | Scope |
|---|---|
| Candidate | Only their own invite, profile, sessions, and (if enabled) their feedback |
| Viewer | Read-only access to drives and reports in their org |
| Hiring Manager | Viewer rights, plus: score overrides, notes, and shortlist/reject on drives they are assigned to |
| Recruiter | Create and manage drives, invites, gates, candidate status, notes, overrides |
| Org Admin | All Recruiter rights, plus users, org settings, values, HR knowledge base, retention, branding |
| Super-Admin | Platform-wide: tenants, prompt/model registry, problem banks, usage |

### 1.3 Permissions matrix

| Action | Viewer | Hiring Mgr | Recruiter | Org Admin |
|---|:-:|:-:|:-:|:-:|
| View drives and reports | ✅ | ✅ (assigned) | ✅ | ✅ |
| Create / edit drive | — | — | ✅ | ✅ |
| Invite candidates | — | — | ✅ | ✅ |
| Gate decisions (advance/hold/reject) | — | ✅ (assigned) | ✅ | ✅ |
| Override scores | — | ✅ (assigned) | ✅ | ✅ |
| Add notes | — | ✅ | ✅ | ✅ |
| Export / share report | — | ✅ | ✅ | ✅ |
| Manage users, values, knowledge base, retention | — | — | — | ✅ |
| Delete candidate data | — | — | — | ✅ |

---

## 2. Screen inventory & navigation

### 2.1 Candidate app (`/c/...`)

| # | Screen | Purpose |
|---|---|---|
| C1 | Invite landing | Drive/role name, company branding, rounds overview, "Get started" |
| C2 | Sign-in | Email → 6-digit OTP (or magic link) |
| C3 | Consent | AI disclosure, data use, recording, retention, accept/decline |
| C4 | Rounds overview | List of rounds with duration, what's assessed, status (Locked / Available / Completed) |
| C5 | System check | Browser, screen size, network latency, (voice: mic) |
| C6 | Resume upload | Drag-drop PDF/DOCX, parsing progress |
| C7 | Profile review | Edit parsed sections; confirm |
| C8 | Project links | Per project: GitHub URL or "not public" + reason; GitHub username |
| C9 | Round lobby | Round instructions, rules, controls tutorial, "Start round" |
| C10 | Interview room | Chat panel + right-side workspace (code editor / design panel / case panel / practical-fit form), timer, progress |
| C11 | Break / between rounds | Single sitting: break timer. Staged: "You'll hear from us" or "Next round available" |
| C12 | Completion | Thank-you, what happens next, optional feedback survey |

### 2.2 Recruiter app (`/app/...`)

| # | Screen | Purpose |
|---|---|---|
| R1 | Drives list | All drives with funnel counts and status |
| R2 | Drive wizard | 5 steps: Role & JD → AI role profile → Rounds & gates → Rubrics → Settings & publish |
| R3 | Drive overview | Pipeline board, candidate table, gate queue, invite management, analytics tab |
| R4 | Candidate detail | Combined report + tabs per round + profile + repos + timeline + notes |
| R5 | Compare | Up to 4 candidates side by side |
| R6 | Gate queue | All candidates awaiting decision across drives |

### 2.3 Admin (`/app/settings/...`)

| # | Screen | Purpose |
|---|---|---|
| S1 | Users & roles | Invite users, assign roles and drives |
| S2 | Company values | Define values and observable behaviors |
| S3 | HR knowledge base | Upload policy docs / FAQ entries used by HR Policy Q&A |
| S4 | Evaluation defaults | Default rubric weights, bands, knockouts, round matrix |
| S5 | Compliance | Retention, compensation-question policy, disclosure text, data requests |
| S6 | Branding | Logo, primary color, candidate-facing company blurb |
| S7 | Usage | Rounds run, AI cost (P1) |

---

## 3. Hiring drive & round pipeline setup

### 3.1 Drive wizard: Step 1, Role & JD (A-1)

**User story:** As a recruiter, I want to paste a JD and get a ready-to-use interview process so I can launch a drive in under 10 minutes.

**Behavior**
- Inputs: role title (required), JD text (required, 200–20,000 chars) or a JD file (PDF/DOCX), department (optional), location(s), employment type.
- On "Analyze", the system runs the **JD Analyzer** (≤ 20 s) and moves to Step 2.

**AC**
- A JD shorter than 200 characters shows "Add more detail for an accurate interview (responsibilities, skills, experience)".
- A JD file is converted to text and shown for confirmation.

### 3.2 Step 2, AI role profile (A-2, A-3, A-4)

**Behavior.** The analyzer returns an editable profile:

| Field | Example | Editable as |
|---|---|---|
| Role category | Coding | Select |
| Seniority | Senior (5–8) | Select |
| Track | IC | Select (IC / People Manager) |
| Must-have skills | Node.js, PostgreSQL, REST API design, AWS | Chips (max 12) |
| Nice-to-have skills | Kafka, Terraform | Chips (max 12) |
| Key responsibilities | "Design and own payment services…" | List |
| Leadership expectations | "Mentor 2–3 engineers; drive design reviews" | List (used by Managerial Round) |
| Domain | Fintech / payments | Text |

**Rules**
- Changing the seniority or track **re-computes the suggested round pipeline** (Step 3) unless the recruiter has already edited it, in which case a confirmation is shown.
- Each skill has an importance weight (must = 2, nice = 1) used in coverage tracking.

### 3.3 Step 3, Rounds & gates (A-4, A-5, PRD §3.1–3.2)

**UI:** a vertical pipeline of round cards. Each card shows: type, enable toggle, duration, sections (expandable list with per-section time and min/max questions), persona name (e.g. "Aarav, Senior Engineer"), pinned questions, and the gate to the next round.

**Defaults by round type**

| Round | Default duration | Default sections (time) |
|---|---|---|
| Technical (Coding, Mid) | 45 min | Intro (3) · Resume deep-dive (8) · GitHub validation (10) · Concepts (10) · Live coding (12) · Wrap-up (2) |
| Technical (Coding, Senior+) | 60 min | Intro (3) · Resume (7) · GitHub (10) · Concepts (8) · System design (15) · Live coding (15) · Wrap-up (2) |
| Technical (Manager/Director) | 45 min | Intro (3) · Resume (8) · Architecture & technical judgement (15) · System design (15) · Wrap-up (4). No coding by default |
| Functional (Non-technical) | 40 min | Intro (3) · Resume (10) · Domain concepts (10) · Domain case (14) · Wrap-up (3) |
| Managerial | 40 min | Intro & leadership story (4) · People leadership (7) · Stakeholders (6) · Execution (6) · Strategy (5) · Situational scenarios (6) · Written case (12, overlaps with discussion) · Wrap-up (2) |
| HR | 25 min | Intro (2) · Motivation & career (5) · Values & culture (6) · Behavioral (6) · Practical fit (4) · Policy Q&A & close (2+) |

**Gate configuration (per transition):** mode (Auto-advance / Manual / Always advance); auto threshold (Strong Hire / Hire / Lean No); next-round expiry (1–30 days, default 7); "notify candidate on advance" (default on); "notify on reject" (default off; uses an org template).

**Business rules**
- At least one round must be enabled.
- Section times must sum to the round duration within ±10%. Otherwise the wizard rescales them proportionally.
- Disabling the Technical Round for a Coding role shows a warning but is allowed (e.g. an HR-only screen).
- Round order can be changed by drag. The HR Round cannot precede itself, and duplicate round types are not allowed in the MVP.
- **Scheduling mode:** Staged (default) or Single sitting. Single sitting shows the total duration (e.g. 2 h 05 min) and break settings.

### 3.4 Step 4, Rubrics (A-6)

- For each enabled round, a weight table of its parameters (PRD §6), pre-filled by category/track. Live validation keeps the total at 100%.
- Round weights for the combined score (PRD §3.1 defaults), renormalized automatically if a round is disabled.
- Recommendation bands and knockout toggles (inherit from org defaults; overridable per drive).

### 3.5 Step 5, Settings & publish

| Setting | Default |
|---|---|
| Coding languages | Python, JavaScript, Java, C++ |
| Coding difficulty | By seniority (Junior: Easy+Medium; Mid: Medium; Senior+: Medium+Hard) |
| Attempts per round | 1 |
| Reconnect window | 15 min |
| Practical-fit band (HR) | Budget range (min–max, currency), max notice period (days), allowed locations, work model (Onsite / Hybrid / Remote), relocation support (Y/N) |
| Candidate-facing company blurb | From org branding |
| Invite expiry | 14 days |
| Accommodation | Allow candidates to request extra time (+25%), with recruiter approval |

**Publish** validates the configuration and generates the open invite link. Drive states: Draft → Active → Paused → Closed. Paused or Closed drives reject new starts but allow in-progress rounds to finish.

**Edge cases**
- Editing an Active drive: changes to rubrics and rounds apply **only to candidates who have not started Round 1**. Others keep the **versioned snapshot** they started with, and reports display the version.

### 3.6 Pinned questions & custom problems (A-8, P1)

- Up to 5 pinned questions per round, each marked "must ask" or "ask if time permits", with a target section.
- Custom coding problem: statement (Markdown), function signature per language, ≥ 3 sample tests, ≥ 5 hidden tests, and a reference solution. The system runs the reference solution against all tests before the problem can be saved.

---

## 4. Candidate onboarding

### 4.1 Invite & sign-in (B-1, B-3)

- **Open link** `/c/i/{driveSlug}`: anyone can register with an email. Duplicate emails resume the existing candidacy.
- **Personal link** `/c/i/{token}`: pre-bound to an email; expires per drive setting.
- OTP: 6 digits, 10-minute validity, 5 attempts, then a 15-minute lockout. Rate limit is 3 OTP sends per 10 minutes per email.

**AC:** an expired token shows "This invitation has expired — contact the recruiter", with the org's contact email.

### 4.2 Consent (B-4)

Content: the AI interviewer disclosure; what is recorded (transcript, code, written responses, browser activity signals); how it is evaluated (by AI, reviewed by humans); retention period; rights (access, deletion); and contact details. Checkboxes: "I consent to…" (required) and "I agree to the integrity rules" (required).

- Decline → exit screen, and the recruiter sees the status "Declined consent".
- Stored: consent text version, timestamp, IP, user agent.

### 4.3 Rounds overview (B-5)

- Card per round: name, duration, sections summary, status.
- Staged mode: only the first round is Available; later rounds show "Unlocks after the previous round is reviewed".
- Tips per round, e.g. HR: "Have your notice period and salary expectations ready".

### 4.4 System check (B-6)

| Check | Pass rule | On fail |
|---|---|---|
| Browser | Supported list | Block with download links |
| Viewport | ≥ 1024×700 for rounds with coding/design/case panels | Block those rounds; others can proceed |
| Network | Round-trip latency to API < 800 ms and streaming test OK | Warn; allow continue |
| Cookies/storage | Enabled | Block |

---

## 5. Resume parsing & analysis

### 5.1 Upload (C-1)

- Formats: PDF, DOCX. Maximum size 5 MB and 10 pages.
- Flow: upload to private storage → text extraction → if the text is under 300 characters, reject as "Scanned/image resume not supported — please upload a text-based PDF or DOCX" → Resume Parser.
- A progress UI with stages: Uploading → Reading → Understanding your experience → Done (typically < 20 s).

### 5.2 Parsed profile (C-2)

| Section | Fields |
|---|---|
| Header | Name, email, phone, location, links (masked from evaluators) |
| Summary | Text |
| Skills | Normalized name, category (language/framework/tool/soft), evidence source (experience/project/listed only) |
| Experience | Company, title, start, end (or present), location, bullets, technologies, **team size managed**, **direct reports** |
| Projects | Name, description, role, tech stack, links, dates |
| Education | Institution, degree, field, years, grade (optional) |
| Certifications | Name, issuer, year |
| Derived | Total years of experience, years in a leadership role, career timeline |

### 5.3 Profile review (C-3)

- Every section is editable. "Add project" and "Remove" are available.
- Candidate edits are stored as a diff against the parsed version. The report shows "Candidate edited: added skill 'Kubernetes'".
- **AC:** the candidate cannot proceed without at least one experience or project entry, which freshers can satisfy with academic projects.

### 5.4 JD match (C-4)

- Per must-have skill, the result is **Evidenced** (used in experience/projects), **Listed only**, or **Missing**.
- Experience relevance (0–100), with reasons.
- Seniority fit: Below / Matches / Above, with reasons.
- Shown to recruiters only, never to the candidate.

### 5.5 Claims to probe (C-5)

The parser extracts specific, testable claims and routes each to a round:

| Claim example | Type | Routed to |
|---|---|---|
| "Reduced p99 latency from 800 ms to 120 ms by introducing Redis caching" | Technical impact | Technical |
| "Designed event-driven order pipeline handling 2M events/day" | Technical design | Technical |
| "Led a team of 8 engineers across 2 time zones" | Leadership scope | Managerial |
| "Hired 12 engineers in 6 months" | People management | Managerial |
| "Promoted twice in 3 years" | Career | HR |
| "Moved from QA to development" | Career transition | HR |

Each claim has a priority (impact × verifiability). Each round's interviewer receives its top claims as a question source.

### 5.6 Resume risk signals (C-6, P1)

Employment gaps > 6 months, overlapping full-time roles, more than 25 listed skills with under 30% evidenced, project descriptions without tech or outcome. Shown to the recruiter as neutral observations (gaps can have legitimate reasons and are **never** scored).

---

## 6. Shared interview engine

Applies to all three rounds.

### 6.1 Interview room UI (E-1, E-3)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ HBE Interview · Senior Backend Engineer · Technical Round   ⏱ 38:12 left │
│ ●Intro ─ ●Resume ─ ◉GitHub ─ ○Concepts ─ ○System design ─ ○Coding ─ ○End │
├───────────────────────────────┬──────────────────────────────────────────┤
│  Chat                         │  Workspace (contextual)                  │
│  🤖 Aarav: In payment-svc,    │  • Code editor (coding)                  │
│  why does RetryPolicy live in │  • Design panel (system design)          │
│  the service layer…           │  • Case panel (domain / managerial case) │
│                               │  • Practical-fit form (HR)               │
│  🧑 You: …                    │  • Repo context card (GitHub section)    │
│                               │                                          │
│ [Type your answer…]   [Send]  │                                          │
│ [Repeat] [Clarify] [Skip] [⏸] │                                          │
└───────────────────────────────┴──────────────────────────────────────────┘
```

- AI messages stream token by token. The candidate input is disabled while the AI is responding.
- The answer box is multi-line, accepts up to 4,000 characters, and supports Markdown code fences. Enter sends; Shift+Enter adds a new line.
- Progress bar: completed (filled), current (ring), upcoming (hollow). Section names are candidate-friendly.
- Timer: round time remaining. It turns amber at 5 min and red at 1 min. A section-level soft timer is internal.

### 6.2 Turn loop & adaptive questioning (E-4 – E-7)

For each candidate answer:
1. The server stores the message and updates the timers.
2. The interviewer agent receives the context ([ARCHITECTURE.md §8.4](ARCHITECTURE.md#84-context-assembly)) and responds with **tool calls** plus a candidate-facing message:
   - `record_assessment(competency, score_1_5, evidence_quote, needs_follow_up)`: a hidden micro-evaluation.
   - `ask_follow_up` / `ask_new_question(source, ref_id)`: the next move.
   - `advance_section(reason)`.
   - Round-specific tools (e.g. `present_coding_problem`, `open_case_exercise`, `capture_practical_fit`).
3. The server validates the action against the state machine (caps, time, order) and persists everything.

**Adaptive rules (server-enforced)**

| Situation | Behavior |
|---|---|
| Answer scored ≤ 2 with `needs_follow_up` | Up to 2 follow-ups on the same topic (rephrase, narrow, or give a scaffold) |
| Two consecutive weak follow-ups | Move to the next topic; mark it "struggled" |
| Answer scored ≥ 4 | Next question in that area is one difficulty level higher, or move on if the area is covered |
| Section time used ≥ 100% | Finish the current exchange (max 1 more turn), then advance |
| Section max questions reached | Advance |
| Round time ≤ 2 min | Jump to wrap-up |
| Uncovered must-have competency and time left | Prioritize it in the next question |

### 6.3 Candidate controls (E-10)

| Control | Behavior | Limits |
|---|---|---|
| Repeat | Re-displays the last question (no AI call) | Unlimited |
| Clarify | Candidate asks what is meant; the AI rephrases without giving away the answer | Not counted against the candidate |
| Skip | Logged as skipped; the AI moves on; counts as "not demonstrated" for that topic | Max 3 per round |
| Pause ("I need a moment") | Pauses the round timer | 2 per round, max 2 min each, auto-resume |

### 6.4 Personas (E-8)

| Round | Default persona | Tone | Never does |
|---|---|---|---|
| Technical | "Aarav, Senior Engineer" (name configurable) | Peer-to-peer, curious, precise | Gives answers, says "correct/wrong", reveals rubric |
| Managerial | "Meera, Engineering Director" / "Hiring Manager" | Senior, probing, situational | Leads the candidate toward a desired answer |
| HR | "Riya, HR Partner" | Warm, conversational, respectful | Asks about protected characteristics; negotiates salary; makes offers or promises |

The persona introduction always states: "I'm an AI interviewer…".

### 6.5 Guardrails (E-9)

| Trigger | Response |
|---|---|
| Candidate asks for the answer or their score | Politely declines and continues |
| Prompt injection ("ignore previous instructions…", hidden text in resume or repo) | Ignored; logged as an integrity event `injection_attempt` (shown to the recruiter) |
| Off-topic requests | Politely redirects |
| Abusive language | One warning; a second occurrence ends the round with status `terminated_conduct` (recruiter notified) |
| Candidate distress ("I'm very nervous") | Reassures, offers a pause |
| Candidate volunteers protected information | Not acknowledged in substance, and redacted from evaluator input |

### 6.6 Persistence & reconnect (E-11)

- Every message, code snapshot, and form change is saved server-side before it is acknowledged.
- On disconnect, the timer **keeps running for 60 s** (grace), then pauses. Rejoining within the reconnect window (default 15 min) restores the full state. After the window the round auto-ends with status `incomplete_disconnect` and is evaluated on the available evidence, with confidence lowered.
- Opening the session in a second tab: the newer tab takes over and the older one shows "Session opened elsewhere".

### 6.7 Wrap-up (E-13)

- The AI asks "Do you have any questions for us?" Answers come from the JD, company blurb, and (in HR) the HR knowledge base. Unknown answers get: "That's a great question — I'll make sure the team follows up." The question is logged in the report.
- Closing: thank the candidate, explain next steps (per the gate config), and end the round.

---

## 7. Technical / Functional Round

### 7.1 Intro & resume deep-dive

- Warm-up: "Walk me through your background and what you're most proud of."
- Deep-dive questions are drawn from **technical claims** (§5.5) and experience. The AI probes ownership ("what part did you personally build?"), decisions ("why X over Y?"), impact ("how did you measure that?"), and failure ("what went wrong?").

### 7.2 GitHub project validation (D-1 – D-9)

**Candidate flow (screen C8)**
1. For each project, the candidate enters a GitHub URL (validated format `github.com/{owner}/{repo}`, optional `/tree/{branch}/{path}` for monorepos) or selects "Not on GitHub" with a reason (Proprietary / Private / Lost / Other + text).
2. The candidate enters a GitHub username, which is auto-filled from the profile links.
3. "Analyze" is non-blocking. The candidate can continue, and the status shows Queued → Analyzing → Ready / Failed.

**Analysis pipeline** (details in [ARCHITECTURE.md §10](ARCHITECTURE.md#10-github-ingestion--analysis-pipeline))

| Step | Output |
|---|---|
| Fetch metadata | Created/pushed dates, fork flag + parent, languages, size, stars, default branch |
| Fetch tree | Full path list (truncated at 10k entries) |
| Select files | README, manifests, entry points, top-N core source files by heuristics, tests; ≤ 60 files / ≤ 150k tokens |
| Commit stats | Total commits, commits by candidate (login + email match), first/last commit dates, active weeks, largest single commit share |
| Similarity checks | Known template/tutorial fingerprints (e.g. create-react-app untouched, course repos), README genericity |
| LLM analysis | Architecture summary, components, design decisions, quality notes, tech match with resume, **grounded questions** |

**Authenticity signals shown to the recruiter**

| Signal | Example display | Concern rule (indicative) |
|---|---|---|
| Original vs fork | "Fork of `xyz/shop-app`; 14 commits ahead" | Fork with ≤ 5 own commits → Medium |
| Candidate commit share | "86% of 112 commits" | < 20% on a solo-claimed project → Medium |
| History shape | "Active over 9 weeks, 31 active days" | > 80% of lines in 1 commit → Medium |
| Tech match | "Resume says Redis + Kafka; repo shows Redis only" | Claimed core tech absent → Medium |
| Boilerplate similarity | "Matches 'MERN e-commerce tutorial' structure (high)" | High → Medium |
| Timeline | "Repo created 3 days before application" | Created < 14 days before the invite → Low (context) |

Signals combine into an overall **Repo Concern** (None / Low / Medium / High). This is shown as context and **feeds the Authenticity parameter only through the evaluator's judgement**, together with the interview answers.

**Grounded questions** (≥ 3 per repo, 3 types):
- *Explain:* "Walk me through what happens when `POST /orders` is called. Start from `routes/orders.ts`."
- *Justify:* "`OrderService` uses optimistic locking via a `version` column. Why that over a DB transaction lock?"
- *Extend / break:* "If we needed refunds, which modules change? What breaks if two refunds for the same order arrive concurrently?"

Each question stores the file path and line range it is grounded in. During the interview the **repo context card** shows the candidate the referenced file snippet (read-only) so the question is fair.

**Edge cases**

| Case | Behavior |
|---|---|
| Repo private/404 | Status Failed: "Repo not accessible". The candidate can fix the link until Round 1 starts; otherwise questions fall back to resume-based project questions |
| Empty or tiny repo (< 3 source files) | Analyzed with a "Minimal code" signal |
| Huge repo (> 500 MB or > 10k files) | The candidate is asked for a sub-path; otherwise only the top-level and the largest language directory are sampled |
| Analysis not ready when the GitHub section starts | The engine swaps in the Concepts section first; if still not ready, uses resume-based project questions |
| No repos linked (all "not public") | The GitHub section becomes "Project deep-dive" with resume-based questions; Authenticity relies on the interview only |
| GitHub rate limit | Exponential backoff via the job queue; the app token is used (5k req/h) |

### 7.3 Conceptual / role questions

- Sources: the must-have skills matrix (coverage-driven), domain, and pinned questions.
- Difficulty ladder per skill: L1 definition/usage → L2 applied scenario → L3 trade-offs/internals → L4 edge cases at scale. The starting level depends on seniority (Junior L1, Mid L2, Senior+ L2–L3).
- Example (Node.js, Senior): L2 "How would you handle a CPU-heavy task in an Express API?" → L3 "Worker threads vs a separate service: when and why?" → L4 "How would you prevent event-loop starvation under burst traffic and detect it in production?"

### 7.4 Live coding (F-1 – F-7)

**Flow**
1. The AI calls `present_coding_problem`. The workspace switches to the **Coding** tab with the problem statement (Markdown), examples, constraints, language selector, starter code, and Run/Submit buttons.
2. The AI asks the candidate to **explain their approach first** (a 1–2 min discussion), then code.
3. **Run** executes the visible sample tests (≤ 5 s) and shows per-test pass/fail, stdout, stderr, and time/memory.
4. The AI observes code snapshots and run results. It may intervene once if the candidate has had no progress for more than 4 minutes ("Want to talk through where you're stuck?").
5. **Hints** on request, at 3 levels: L1 nudge, L2 approach, L3 key insight. Each hint used lowers the maximum Code Quality / Problem-Solving achievable, and the evaluator is told this.
6. **Submit** runs the hidden tests. The candidate sees only "X/Y tests passed" (no hidden inputs). Up to 3 submits are allowed; the best one counts.
7. Follow-up discussion: time/space complexity, edge cases, "how would you test this?", "how would this change for 10× the data?"

**Problem selection**
- From the curated bank, filtered by language support, difficulty for the seniority, and domain tags matching the JD. Problems the same candidate has already seen are excluded.
- AI-adapted variants (renamed context, changed constraints) are used only after the reference solution passes all tests in the sandbox.

**Sandbox limits:** CPU 2 s per test (adjusted per language), memory 256 MB, no network, output ≤ 64 KB.

**Data captured:** snapshots every 10 s (diff-based), each run/submit with results, hint usage, paste events (size, timestamp), language switches.

**Edge cases**
- The sandbox is unavailable: Run shows "Execution temporarily unavailable". The AI evaluates by reading the code and discussing it, and the report notes "Tests not executed".
- The candidate never submits: the last snapshot is evaluated against the hidden tests automatically at round end.

### 7.5 System design (F-9, Senior+ technical roles)

- The AI presents a domain-relevant prompt (e.g. "Design a payment retry and reconciliation service for 5k TPS").
- The **design panel** has structured, editable areas: Requirements (functional/non-functional) · High-level components · Data model · APIs · Scaling & bottlenecks · Failure handling · Trade-offs. Text is auto-saved, with a simple ASCII/Markdown diagram allowed.
- The AI probes in phases: clarifying requirements → high-level design → deep-dive into 1–2 components → scaling and failure modes → trade-offs.
- Evaluated within Problem-Solving and Role Fit (and Communication).

### 7.6 Domain case (F-11, non-technical roles)

- Case examples by function:
  - Sales: "A key account says your price is 20% above a competitor's. Outline your approach."
  - Support: "A customer escalates an unresolved outage publicly; respond and plan."
  - HR Executive: "Design an onboarding plan for 50 campus hires."
  - Ops: "Reduce order-processing errors by 30% in a quarter."
- A written response in the **case panel** (10–14 min), followed by an AI discussion.

---

## 8. Managerial Round

### 8.1 Purpose & applicability (G-1, G-2)

- Assesses whether a Senior+ candidate can **lead people, influence stakeholders, deliver outcomes, and exercise judgement** at the level of the role.
- Default-enabled for Senior, Lead/Staff/Principal, Manager, and Senior Manager/Director. Optional for Mid.
- Two tracks:

| Aspect | IC track (Senior, Staff, Principal) | People Manager track (Manager, Sr Manager, Director) |
|---|---|---|
| Leadership focus | Mentoring, technical direction, design reviews, raising the bar | Building and growing teams, hiring, performance, org design |
| Influence | Influencing without authority across teams | Managing up, cross-org alignment, negotiating resources |
| Execution | Leading complex technical initiatives | Portfolio delivery, roadmap, capacity planning |
| Strategy | Technical strategy, build-vs-buy, tech debt | Business alignment, budgeting, multi-quarter planning |
| Case exercise | e.g. "Propose a plan to migrate a monolith with no downtime and convince 3 teams" | e.g. "Your team missed two releases and attrition is rising — 30-60-90 plan" |

### 8.2 Sections & flow (G-3)

| Section | Goal | Example questions (People Manager track, Manager level) |
|---|---|---|
| Intro & leadership story | Context: team size, scope, style | "Tell me about the largest team you've led. How was it structured, and what did you own?" |
| People leadership | Hiring, growth, feedback, underperformance | "Tell me about someone on your team who was underperforming. What did you do, and what happened?" |
| Stakeholder management & influence | Managing up/across, conflict | "Describe a time you disagreed with your manager or product on a priority. How was it resolved?" |
| Execution & delivery | Planning, risk, recovery | "Tell me about a project that was going off track. How did you detect it and what did you change?" |
| Strategic thinking & decision-making | Trade-offs, long-term view | "How did you decide how much capacity to allocate to tech debt versus features last year?" |
| Situational scenarios | Judgement in dilemmas | "Your top performer asks for a promotion you can't justify yet, and hints at leaving. What do you do?" |
| Written case exercise | Structured planning under constraints | See §8.5 |
| Wrap-up | Candidate questions | — |

Question selection adapts to:
- **Leadership claims** from the resume (e.g. "Led a team of 8": the AI probes how the team was built and managed).
- The **Technical Round summary** (e.g. weak testing practices: "How do you ensure quality standards in your team?").
- The **JD leadership expectations** from the role profile.

### 8.3 STAR probing (G-5)

For each behavioral answer, the interviewer tracks a hidden STAR checklist:

| Element | Probe if missing |
|---|---|
| Situation | "Can you set the context — team, timeline, what was at stake?" |
| Task | "What specifically were you responsible for?" |
| Action | "What did **you** personally do, step by step?" (also triggered when the candidate says "we" throughout) |
| Result | "What was the outcome? How did you measure it?" |
| Reflection (bonus) | "What would you do differently?" |

**Rules**
- At most 2 STAR probes per story. A STAR completeness score (0–4) is recorded in the micro-evaluation.
- **Hypothetical-answer detection:** if the candidate answers a behavioral question with "I would…", the AI asks for a real example once. If there is none, it accepts the hypothetical answer and notes it (lower evidence weight).

### 8.4 Situational judgement scenarios (G-6)

- A bank of scenarios per competency, tagged by seniority and track, and parameterized with the candidate's domain from the JD.
- 2–3 scenarios per round. At least one covers **ethics/integrity** (e.g. pressure to ship with a known security issue; a manager asks to inflate metrics).
- The AI probes: options considered, stakeholders affected, the decision, risks, and communication plan.
- Evaluation looks at the reasoning (fairness, stakeholder awareness, risk handling, ownership), **not** at matching a single "correct" answer.

### 8.5 Written case exercise (G-7)

**Flow**
1. The AI calls `open_case_exercise(case_id)`. The workspace opens the **Case panel** with the brief, constraints, data (a small table when relevant), and the deliverable format.
2. Timebox: 10–15 min (configurable), with a countdown inside the panel. Chat stays available for clarifying questions.
3. Structured response template, for example for a recovery plan: Diagnosis · Immediate actions (first 30 days) · Stabilization (60) · Improvement (90) · Risks · Metrics to track · Stakeholder communication.
4. On submit (or when time expires, which auto-submits), the AI discusses the response with 2–4 probing questions ("You plan to add 2 engineers — how do you avoid Brooks's law here?").

**Case bank examples**

| Case | Track | Deliverable |
|---|---|---|
| Failing delivery & attrition | Manager | 30-60-90 plan |
| Prioritize 8 initiatives with fixed headcount | Manager / Director | Ranked list + rationale + what to drop |
| Monolith → services migration buy-in | IC (Staff) | Proposal + influence plan |
| Production incident post-mortem leadership | IC / Manager | Incident comms + post-mortem actions |
| Budget cut of 20% | Director | Trade-off plan + communication |

**Edge cases:** a blank submission is scored on the discussion only, and the report notes "Case not attempted". Pasted content over 300 characters is flagged as an integrity event.

### 8.6 Prioritization exercise (G-8, P1)

Drag-and-drop ranking of 6–10 items with a short rationale per item. The AI questions the top and bottom choices.

### 8.7 Acceptance criteria (Managerial Round)

- AC-M1: every Managerial Round covers ≥ 4 of the 5 parameters with ≥ 1 evidence item each, or marks the missing one N/A with a reason.
- AC-M2: ≥ 1 ethics scenario is presented in every Managerial Round.
- AC-M3: the case exercise is presented in every Managerial Round unless the recruiter disabled it.
- AC-M4: leadership claims from the resume tagged "Managerial" are probed (≥ 1 when present).
- AC-M5: the report includes a STAR completeness summary across stories.

---

## 9. HR Round

### 9.1 Purpose & applicability (H-1)

Assesses motivation, culture and values alignment, behavioral competencies, career intent, and professional conduct. Captures **practical fit** and answers policy questions. Default-enabled for all roles. Default 25 min (20 for Intern/Junior).

### 9.2 Sections & flow (H-2)

| Section | Goal | Example questions |
|---|---|---|
| Intro | Rapport, set expectations | "This round is about you, your goals, and how you like to work." |
| Motivation & career story | Why this role/company; career coherence | "What made you apply for this role?" · "Walk me through your career moves and what drove each one." |
| Values & culture | Evidence for org values (§9.3) | For "Ownership": "Tell me about a time you took responsibility for something outside your job description." |
| Behavioral competencies | Teamwork, feedback, adaptability, learning | "Describe a time you received tough feedback. What did you do with it?" |
| Practical fit | Structured logistics (§9.4) | "What's your current notice period? Is it negotiable?" |
| Policy Q&A & close | Answer questions from the knowledge base (§9.5) | "What would you like to know about working here?" |

STAR probing (§8.3) applies to behavioral and values questions, with gentler phrasing and at most 1 probe per story for Intern/Junior candidates.

### 9.3 Company values alignment (H-3)

- The Org Admin defines 3–8 values. Each value has a name, description, 2–4 observable behaviors, and optionally anti-behaviors.
  - Example: **Customer Obsession**. Behaviors: "seeks customer feedback proactively", "escalates customer-impacting issues". Anti-behavior: "blames customers".
- The interviewer covers ≥ 3 values per round (rotating by priority). The evaluator maps evidence to values and produces a per-value rating (Strong / Some / Limited / No evidence), which rolls up into **Culture & Values Alignment**.
- If no org values are configured, a default set is used: Ownership, Collaboration, Integrity, Learning, Customer Focus.

### 9.4 Practical fit capture & compatibility (H-5 – H-7)

**Capture flow:** the AI asks conversationally. In parallel, the **Practical-fit form** opens in the workspace, pre-filled by the AI from the conversation, and the candidate **confirms or edits** it before submitting.

| Field | Type | Notes |
|---|---|---|
| Current location | City, country | |
| Willing to relocate | Yes / No / Depends (text) | Shown only if the drive location differs |
| Preferred work model | Onsite / Hybrid / Remote / Flexible | |
| Notice period | Days; negotiable Y/N; buyout possible Y/N | "Serving notice" option with last working day |
| Earliest joining date | Date | |
| Expected compensation | Range (min–max), currency, period (annual) | Required unless the candidate chooses "Prefer to discuss later" |
| Current compensation | Range | **Only if the org setting is ON** (off by default; jurisdiction warning in settings) |
| Other offers in hand | Yes / No (optional), timeline (optional) | Optional; never pressured |
| Work authorization | Yes / Needs sponsorship | Only if the drive is configured for it |

**Compatibility check** against the drive's practical-fit band:

| Field | Match | Negotiable | Mismatch |
|---|---|---|---|
| Expected compensation | Min expectation ≤ budget max | Min expectation ≤ budget max + 15% | Above that |
| Notice period | ≤ max notice | ≤ max + 30 days, or negotiable/buyout | Above that |
| Location | In allowed locations, or willing to relocate | "Depends" | No |
| Work model | Compatible | Flexible | Incompatible |

- Shown as a panel with a per-field status and an overall status (worst field).
- **Not part of the HR score**, and never shown to the candidate.
- The AI **never negotiates or comments** on compensation ("Thanks, I've noted that; the team will discuss details in later stages").

### 9.5 Policy Q&A (H-8)

- Knowledge base (KB): Org Admin uploads policy documents (PDF/DOCX/MD) and/or FAQ entries. These are chunked and indexed (see [ARCHITECTURE.md §9.4](ARCHITECTURE.md#94-hr-knowledge-base-retrieval)).
- When the candidate asks a question, the system retrieves the top passages, and the AI answers **only from those passages**, citing the policy name in the UI ("From: Leave Policy 2026").
- If nothing relevant is found or confidence is low: "I don't have that information — I'll pass your question to the HR team." The question is logged under "Candidate questions to follow up" in the report.
- The AI never commits to anything ("You will get X") and uses policy language ("As per the policy…").

### 9.6 Compliance guardrails (H-9)

**Prohibited topics** (never asked, never recorded in evaluation): age or date of birth, marital status, pregnancy or family planning, children or childcare, religion, caste, ethnicity, nationality (beyond work authorization), health or disability (beyond "can you perform the essential functions, with or without accommodation" if configured), sexual orientation, gender identity, political affiliation, union membership, salary history (unless enabled where legal).

**Enforcement layers**
1. Persona instructions with explicit prohibitions.
2. **Output filter:** every HR interviewer message is checked by a fast classifier (Haiku) before it is sent. Violating messages are regenerated, and the event is logged for super-admin review.
3. **Input redaction:** if the candidate volunteers protected information, it is redacted (`[REDACTED: personal information]`) from the evaluator's transcript copy. The raw transcript is retained under access control for audit.
4. A compliance test suite in CI (adversarial prompts) must pass before prompt changes deploy.

### 9.7 Red flags (H-11, P1)

Shown to the recruiter only, as neutral items to verify:
- The stated reason for leaving conflicts with resume dates.
- Title or tenure differs from the resume.
- Unprofessional conduct (hostile language, disrespect).
- Contradictions with earlier rounds (cross-round check, K-5).

### 9.8 Acceptance criteria (HR Round)

- AC-H1: practical-fit fields are confirmed by the candidate before the round ends (or explicitly marked "prefer to discuss later").
- AC-H2: 0 prohibited-topic questions across the compliance test suite (≥ 200 adversarial cases).
- AC-H3: Policy Q&A answers cite a KB source, or defer. No uncited policy claims.
- AC-H4: ≥ 3 org values are assessed per round.
- AC-H5: the practical-fit compatibility panel is computed when the drive has a band configured.

---

## 10. Evaluation & scoring

### 10.1 Pipeline (I-1 – I-6)

```
Round ends ─► Freeze evidence bundle ─► Redact PII & protected info
  ─► Evaluator run #1 ─┐
  ─► Evaluator run #2 ─┴─► Compare (any parameter Δ > 1?) ──yes──► run #3
  ─► Median per parameter ─► Evidence verification ─► Compute round score/recommendation
  ─► Apply knockouts ─► Confidence ─► Persist round report ─► Gate evaluation
```

**Evidence bundle** (per round): role profile, rubric with anchors, round sections, redacted transcript with message IDs and timestamps, micro-evaluations, round-specific artifacts (code + test results + hints, design panel, case response, practical-fit data, repo analysis), integrity summary (for context only), and the prior-round **summaries** (not scores).

**Evaluator output per parameter:** `score (1–5 | null)`, `justification`, `evidence[] {type: transcript|code|artifact|repo, ref_id, quote}`, `confidence`. Plus round-level strengths, concerns, and summary.

**Evidence verification:** each `transcript` quote must match (normalized fuzzy match ≥ 0.9) text inside the referenced message. Each `code` ref must exist in a snapshot or submission. Invalid evidence is removed. If a parameter falls below 2 valid evidence items, it is re-run once. If it is still short, the score stands and confidence is lowered.

**Confidence** is High, Medium, or Low, computed from: coverage of parameters, number of valid evidence items, skipped questions, round completion, and evaluator agreement.

### 10.2 Parameter anchors

#### Technical / Functional Round

| Parameter | 1 – Insufficient | 3 – Adequate | 5 – Exceptional |
|---|---|---|---|
| Role Fit | Few must-have skills demonstrated; level far below the role | Most must-haves demonstrated at a working level; some gaps | All must-haves demonstrated with depth beyond the level; strong nice-to-haves |
| Resume & Project Authenticity | Cannot explain own projects or code; answers contradict the repo/resume | Explains main flows but is vague on decisions or details; some reliance on generic answers | Explains non-obvious decisions, alternatives tried, bugs fixed; details consistent with the repo |
| Code Quality | Does not compile or run; no structure; ignores edge cases | Correct for main cases; readable; some edge cases missed; little testing thought | Correct incl. edge cases; clean, idiomatic, well-structured; proactively discusses tests |
| Problem-Solving | Cannot decompose the problem; no workable approach even with hints | Reaches a workable approach with some hints; basic complexity awareness | Clarifies requirements, compares approaches, optimal solution, precise complexity and trade-off reasoning |
| Communication Clarity | Unclear, disorganized, or does not answer the question | Generally clear; occasionally rambling or imprecise | Structured, concise, precise; adapts depth to the question |

#### Managerial Round

| Parameter | 1 – Insufficient | 3 – Adequate | 5 – Exceptional |
|---|---|---|---|
| Leadership & People Development | No real examples of developing others; avoids people issues | Some examples of mentoring/feedback; handles issues reactively | Concrete examples of growing people, handling underperformance fairly, building strong teams; measurable outcomes |
| Stakeholder Management & Influence | Escalates or avoids conflict; cannot influence without authority | Manages stakeholders adequately; some examples of alignment | Proactively aligns diverse stakeholders; clear influence strategies; turns conflict into outcomes |
| Execution & Delivery Ownership | Blames others; no planning or risk practices | Plans and delivers with some risk management; partial ownership | Strong ownership; anticipates risks; recovers failing initiatives with clear actions and metrics |
| Strategic Thinking & Decision-Making | Decisions are ad hoc; no trade-off reasoning | Reasonable decisions with some trade-off awareness; short-term focus | Ties decisions to business goals; explicit trade-offs; data-informed; long-term view |
| Situational Judgement & Conflict Resolution | Unfair, unethical, or harmful choices in scenarios | Reasonable choices; misses some stakeholders or risks | Fair, ethical, balanced decisions; considers all stakeholders; clear communication plan |

#### HR Round

| Parameter | 1 – Insufficient | 3 – Adequate | 5 – Exceptional |
|---|---|---|---|
| Motivation & Role Interest | Generic or no reasons; unaware of what the role involves | Reasonable reasons; general understanding of the role | Specific, genuine reasons tied to the role and company; clear understanding of expectations |
| Culture & Values Alignment | Evidence contradicts the org values | Some evidence for some values | Strong behavioral evidence across most assessed values |
| Behavioral Competencies | No concrete examples; poor teamwork or feedback handling | Some concrete examples with partial STAR completeness | Rich, specific STAR examples showing ownership, adaptability, and growth |
| Career Goals Alignment | Incoherent career story; goals clearly misaligned with the role | Mostly coherent; partial alignment | Coherent narrative; role is a clear and logical step toward the stated goals |
| Professional Communication & Conduct | Unprofessional, inconsistent, or evasive | Professional and generally clear | Highly professional, articulate, transparent, and consistent |

### 10.3 Scoring math

- Round score = Σ over assessed parameters of (score ÷ 5 × weight) ÷ Σ assessed weights × 100.
- Technical coding sub-score feeding Code Quality: hidden-test pass rate 40% + quality review 40% + approach/explanation 20%. The maximum is capped by hints: L1 −0, L2 −0.5, L3 −1.0 (on the 5-point scale).
- Final score = Σ (round score × round weight) ÷ Σ weights of completed rounds.
- Bands and knockouts are as defined in PRD §6.

### 10.4 Overrides (I-7)

- Per parameter: new score (1–5) plus a reason (≥ 20 chars). This triggers a recompute of the round score, recommendation, and final score.
- The report shows "AI: 3 → Recruiter (Priya S.): 4 — reason…". The original values are kept forever (for the life of the record).

---

## 11. Reports

### 11.1 Round report (per round)

| Section | Contents |
|---|---|
| Header | Candidate (masked toggle), drive, round, date, duration, completion status, confidence, model/prompt versions |
| Scorecard | Round score, recommendation badge, parameter bars with scores, weights, and overrides |
| Summary | 4–6 sentence narrative |
| Strengths / Concerns | 3–5 each, each linked to evidence |
| Parameter detail | Justification + evidence list (click to jump to the transcript or code line) |
| Round-specific | **Technical:** skills coverage matrix, claims verification table, GitHub authenticity panel, coding results (tests, complexity, hints, replay), system design notes. **Managerial:** STAR summary per story, scenario decisions, case response with AI annotations. **HR:** per-value evidence ratings, practical-fit panel, candidate questions to follow up, red flags |
| Integrity | Signals and concern level |
| Transcript | Full transcript with section markers and timestamps |

### 11.2 Combined report

| Section | Contents |
|---|---|
| Final verdict | Final score, recommendation, confidence, Partial flag |
| Round strip | Each round's score and recommendation, with links |
| Executive summary | Cross-round narrative (≤ 150 words) |
| Top strengths / risks | Synthesized across rounds |
| Practical fit | Compatibility panel (from HR) |
| Focus areas for the human panel | 3–5 items, e.g. "Verify depth in Kafka consumer scaling — answers were partially correct, repo had no Kafka usage" |
| Cross-round consistency | Contradictions detected (P1) |
| Decision log | Gate decisions, overrides, notes |

### 11.3 Export & sharing (I-8, P1)

- PDF with org branding and a "masked mode" option (hides name/contact).
- Share link: read-only, expires in 1–30 days, optional passcode, access logged.

---

## 12. Recruiter dashboard & pipeline management

### 12.1 Drives list (J-1)

Columns: drive, role, seniority, status, rounds (icons), invited, in progress, awaiting gate, completed, shortlisted, created by, updated. Filters: status, owner. Search by title.

### 12.2 Pipeline board (J-2)

- Kanban columns: Invited · Profile in progress · Round 1 · Gate 1 · Round 2 · Gate 2 · Round 3 · Completed · Shortlisted · Rejected · On hold · Withdrawn/Expired.
- Card: name, final or latest round score badge, practical-fit dot (green/amber/red), integrity dot, and a time-in-stage indicator.
- Drag to Shortlisted/Rejected/On hold is allowed. Dragging across gates triggers the gate action with a confirmation.

### 12.3 Candidate table (J-3)

Columns: name, status, final score, per-round scores, recommendation, practical fit, integrity, completed at. Sort by any score column, including per-parameter scores via a column picker. Bulk actions: advance, reject, export CSV.

### 12.4 Gate queue (J-4)

- Lists candidates whose last round is evaluated and whose gate needs a decision.
- Each row has an inline summary: round score, recommendation, top strength, top concern, and quick actions **Advance**, **Hold**, **Reject**, plus "Open report".
- Auto-advanced candidates appear in an "Auto-advanced (last 7 days)" tab for audit.

### 12.5 Analytics (J-7, P1)

Funnel by round, drop-off by section, average duration per round, score distributions per parameter, practical-fit mismatch reasons, and recruiter–AI agreement rate (when overrides exist).

---

## 13. Integrity & fairness

### 13.1 Browser signals (K-1)

| Signal | Captured as |
|---|---|
| Tab/window blur | Count, total duration, timestamps |
| Copy / paste | Event, size, target (chat/editor/case); text content stored only for pastes into answers |
| Fullscreen exit | If the drive requires fullscreen (setting, default off) |
| Answer timing | Typing time vs answer length (e.g. a 400-word answer appearing in 5 s) |
| DevTools open (heuristic) | Flag only |

**Concern level:** None / Low / Medium / High, computed with transparent rules (e.g. ≥ 3 large pastes in answers → Medium; > 25% of round time with focus lost → Medium; both → High).

### 13.2 Principles (K-2, K-4)

- Integrity signals are **never** part of the scores. They appear as a separate panel with explanations.
- The evaluator receives integrity data only as context to interpret evidence (e.g. "a pasted answer may not reflect the candidate's own words"), and must not change a score purely because of a signal.
- The evaluator sees masked candidate identity: no name, email, photo, college name (configurable), or gender-indicative pronouns, which are neutralized in summaries.

### 13.3 Accommodations

Candidates can request extra time (+25% or +50%) through a link on the consent screen. The recruiter approves, and timers scale. Accommodation status is never visible to evaluators.

---

## 14. Administration & org settings

| Setting | Details |
|---|---|
| Users | Invite by email, assign role, assign drives (for Hiring Managers), deactivate |
| Company values | CRUD; 3–8 values; used by the HR Round |
| HR knowledge base | Upload docs (≤ 20 MB each, ≤ 50 docs) or FAQ entries; re-index on change; preview "Ask the KB" test box |
| Evaluation defaults | Rubric weights per round/category/track, bands, knockouts, round matrix |
| Compliance | Retention days (30–730, default 180); compensation-question policy; consent/disclosure text (versioned); data subject requests (export/delete a candidate by email) |
| Branding | Logo, primary color, company name, candidate-facing blurb, support email |
| Email templates | Invite, reminder, next-round, rejection (optional), completion |

**Data deletion:** deletes resume files, transcripts, code, case responses, and reports for that candidate. An anonymized audit stub remains (drive ID, dates, "deleted on request").

---

## 15. Notifications

| Event | Recipient | Channel | Default |
|---|---|---|---|
| Invite sent | Candidate | Email | On |
| Reminder (not started, 48 h before expiry) | Candidate | Email | On (P1) |
| Round completed | Candidate | Email ("we've received your interview") | On |
| Advanced to next round | Candidate | Email with link and expiry | On |
| Rejected | Candidate | Email (org template) | Off |
| Gate decision needed | Drive recruiters | Email digest (daily) + in-app badge | On |
| Round terminated (conduct) / injection attempt | Drive recruiters | In-app | On |
| Report ready | Drive recruiters | In-app | On |

---

## 16. Global error states & edge cases

| Situation | Behavior |
|---|---|
| AI provider error/timeout mid-turn | Retry ×3 with backoff (invisible to the user for ≤ 10 s). After that, show "We're having trouble — your progress is saved", **pause the timer**, and auto-retry every 15 s for up to 5 min. If it still fails, end the round as `incomplete_system` and let the recruiter grant a retake |
| Evaluation job failure | Retried by the queue (×5). After that, the report status is "Evaluation delayed" and ops are alerted |
| Candidate closes the browser mid-round | Reconnect rules (§6.6) |
| Candidate tries to restart a completed round | Blocked: "This round has been submitted" |
| Drive paused during a round | The round completes normally; next-round invites are held |
| Candidate invited to two drives in the same org | Separate candidacies; the resume can be reused (with confirmation) |
| Very long answers (> 4,000 chars) | Blocked at input with a counter |
| Non-English answers | The AI asks once to continue in the interview language; communication is assessed accordingly (multilingual in P2) |
| Time zone differences | All times are shown in the viewer's local time; stored in UTC |

---

## 17. Phase 2 features (v1.3)

| Feature | Where | Behaviour |
|---|---|---|
| **Drive analytics** (J-7) | Drive → Analytics | KPI tiles (candidates, completion rate, average final score, AI scores kept vs overridden, gate agreement between manual decisions and the AI recommendation, median round length), funnel, drop-off by section, score histograms (final + each round) with the Hire band marked, average parameter scores per round, practical-fit mismatches, integrity levels. Every chart has a table view and per-mark tooltips |
| **AI usage & cost** (L-3) | Admin → AI usage | Date-range presets; estimated cost by stage and model from recorded tokens (input, cache read/write, output), calls, errors, p50 latency, cost per completed round, share of input served from cache |
| **Compare candidates** (J-6) | Drive → select 2–4 → Compare | Side-by-side final/round/parameter scores (highest bolded, overrides included), recommendation and confidence, top strengths and risks, practical fit, integrity |
| **PDF export** (I-8) | Candidate → Export & share | Printer-friendly report (browser "Save as PDF") in three variants: named, identity-masked, with transcripts. Exports are audited |
| **Share links** (I-8) | Candidate → Export & share | Read-only, expiring (1–30 days), optional passcode (5 attempts / 15 min), masked by default; view count; revocable; every view audited |
| **Code replay** (F-6) | Candidate → Technical round → Live coding | Slider/playback over 10-second editor snapshots, runs and submissions with test results |
| **Prioritisation exercise** (G-8) | Managerial round | Drag-and-drop ranking (keyboard up/down too) plus rationale; on by default for Manager/Director levels, optional for others; discussed by the AI and evaluated under Strategic Thinking |
| **Inline snippet editor** (F-8) | Interview room → `</> Code` | Write a code/SQL snippet with a language tag and insert it into an answer as a fenced block |
| **AI-generated answer flags** (K-3) | Integrity panel | Long answers with generic, scripted or pasted characteristics are flagged (medium/high) with a reason and message link; raises the integrity concern level; never affects scores |
| **Template library** (A-9) | New hiring drive | 9 starter JDs (Backend, Frontend, Senior Backend, Data Analyst, DevOps/SRE, Engineering Manager, Account Executive, Support, HR Executive) |
| **CSV invites & reminders** (B-2) | Drive → Invite candidates | CSV upload (name/email in any order, header optional, quoted fields); one reminder email 48 h before an invitation or next-round window expires |
| **Custom coding problems** (A-8) | Drive → Coding problems | Statement, sample and hidden stdin/stdout tests and a reference solution; saved problems are live only after the reference solution passes every test in the sandbox; validated custom problems are preferred over the bank for that drive |
| **Model admin** (L-4) | Settings → AI models | Per-stage model override and interviewer effort (applied within a minute); reports record the evaluator model |
| **Re-evaluate** | Candidate → round header | Re-runs the evaluation for a round (e.g. after a model change) |
| **Hiring-manager scoping** | Settings → Users | Hiring managers see and act only on drives assigned to them (pages and APIs) |

---

## 18. Phase 3 features (v1.4)

### 18.1 Multilingual interviews (E-12)

- **Setup:** Drive → Configure → *Interview languages* — any of 12 languages (English, Hindi, Bengali, Tamil, Telugu, Marathi, Gujarati, Kannada, Malayalam, Spanish, French, Arabic). English is the default; the first selected is pre-chosen for candidates.
- **Candidate:** the round lobby shows an *Interview language* selector (native names, e.g. हिन्दी) when more than one is enabled. The interviewer speaks and writes in that language; coding problems, code and technical terms stay in English. Voice mode uses the language's speech locale for dictation and read-aloud; right-to-left scripts render correctly.
- **Rules:** the language is fixed for the round once it starts (stored on the session). A language not enabled for the drive is rejected. Evidence verification is Unicode-aware, so quotes in any script are checked against the transcript. The evaluator scores content, never language fluency, unless the role requires that language.

### 18.2 OCR for scanned resumes (C-7)

- Image-only PDFs and PNG/JPEG photos of resumes are transcribed by the AI (document/image input) before parsing. If the scan is illegible the candidate is asked to upload a clearer copy.
- The staff resume card shows an **OCR** badge so reviewers know the text came from a scan; the fairness monitor tracks OCR vs text resumes as a cohort.

### 18.3 GitLab and Bitbucket repositories (D-6)

- Candidates can link public repositories on github.com, gitlab.com and bitbucket.org (including `/tree/<branch>/<path>` links). Validation, file selection, commit-authorship statistics and the repository discussion behave the same on every host. Private repositories remain out of scope (decision §11-4).

### 18.4 System-design whiteboard (F-10)

- **Candidate:** the system-design panel has *Written design* and *Whiteboard* tabs. Tools: box, ellipse, arrow (with optional label, e.g. REST/async), text, pen, select/move, undo, delete, clear. The board autosaves (debounced) and shows *Saved · the interviewer can see this board*. Locked on submission.
- **AI:** the rendered board is sent to the interviewer as an image with the next turn so it can ask about the diagram, and to the evaluator as evidence (with the shape labels as text).
- **Staff:** the board image appears with the written response on the candidate page (the print/PDF export includes the written design only).

### 18.5 Opt-in webcam presence proctoring (K-6)

- **Setup:** Drive → Configure → *Webcam proctoring* (off by default) with a snapshot interval (30–600 s).
- **Consent:** when enabled, consent includes a separate webcam checkbox and the lobby explains what is captured. Accepting requires the webcam consent too (enforced by the server).
- **During the round:** a small self-view shows *Camera on*. A low-resolution JPEG is taken at the interval; the AI checks only *how many people are visible, whether a face is visible, and whether a phone/second screen is visible*. Camera turned off/denied is logged as an integrity event.
- **Staff:** snapshot gallery inside the Integrity panel with flagged snapshots highlighted; counts feed the integrity concern level. Never part of the score.
- **Not built (by design):** face matching, identity verification, emotion or attention analysis — these need biometric processing under DPDP/GDPR and are unreliable across skin tones and lighting.

### 18.6 Integrations: REST API & webhooks (L-6)

- **Settings → Integrations** (admin): create scoped API keys (`drives:read`, `candidates:read`, `candidates:write`) — the key is shown once, only its hash is stored; revoke at any time. Register webhook endpoints for `candidate.invited`, `round.completed`, `round.evaluated`, `gate.decided`, `candidate.completed`, `candidate.status_changed`; the signing secret is shown once; *Send test* delivers a signed `ping`; pause/resume/delete; the 15 most recent deliveries with status, attempts and response code.
- **API:** list drives, list a drive's candidates with stage and final result, invite candidates (returns personal links), fetch a candidate's per-round status, scores and gate history. Evidence, transcripts and integrity details are not exposed.
- **Delivery:** HMAC-SHA256 over `timestamp.body`, at-least-once with exponential back-off (6 attempts), unique delivery id, no redirects, HTTPS and no internal addresses in production. Delivery history is kept 30 days. Full reference: [API.md](API.md).

### 18.7 Candidate feedback & fairness monitoring (K-7, I-9)

- **Post-round survey:** after each round (on the completion card and on the candidate's page) an optional 30-second survey: overall, fairness/relevance, clarity, tools (1–5) and a comment. One response per round; never shown to the evaluator; never affects scores.
- **Released feedback:** on the candidate page a recruiter clicks *Draft with AI* to turn the round reports' narrative into candidate-facing strengths, growth areas and a closing note (no scores, recommendations, integrity signals, compensation or decisions), edits it, and clicks *Release to candidate*. It then appears on the candidate's interview page; it can be updated or withdrawn. Drafting and release are audited.
- **Fairness monitor** (Drive → Fairness): round pass rates (AI recommendation Hire/Strong Hire) and mean scores split by **process cohorts** — input mode, interview language, how they applied (open link vs invite), resume format (OCR vs text), drive version, and round. A cohort is flagged when its pass rate is below 80% of the best cohort's (four-fifths rule); cohorts under 5 rounds are not compared. Also shows evaluator-run disagreement rate and survey ratings per mode/language, and recent comments.
- **Limits:** HBE Interview collects no demographic data, so it cannot test for bias by gender, caste, age, disability or other protected characteristics. Such audits need an independent, consented data source.

### 18.8 Still out of scope after Phase 3

| Item | Why |
|---|---|
| Private repositories (D-3) | Decision §11-4 (public only) |
| Vendor-specific ATS connectors (Greenhouse, Lever, Darwinbox…) | Covered generically by the REST API and webhooks |
| Identity verification / face matching | Biometric data; see 18.5 |

*(Multiple organisations and AWS code execution, listed above in earlier versions, were delivered in Phase 4 — §19.)*

---

## 19. Phase 4 features (v1.5)

### 19.1 Multiple organisations

- **Model:** every hiring drive, candidate, user, setting (company profile, values, consent, retention, compensation toggle), HR knowledge-base document, API key and webhook belongs to one organisation. The same person applying to two organisations is two separate candidate records; neither organisation can see the other's.
- **Staff:** users belong to one organisation and see only its data — drive lists, decisions queue, candidate pages, exports, analytics, fairness, usage, settings and integrations. Opening another organisation's link shows *not found*. The header shows the organisation name.
- **Candidates:** links (personal, open-application, share) work unchanged; the candidate sees their hiring organisation's name, values, consent text and policies.
- **Existing data:** migrated into the *default* organisation; existing admins became **platform admins**.
- **Acceptance:** an admin of organisation B gets 404/403 for every page and API of organisation A (drives, candidates, reports, shares, problems, proctor images, KB, users, webhooks, keys, platform), and nothing in A changes (`scripts/smoke-phase4.ts`, 87 checks).

### 19.2 Platform console (platform admins)

- **Platform** page: every organisation with users, drives, candidates, rounds in the last 30 days, estimated AI cost (30 days and month to date) and its monthly **AI budget alert**.
- **Create organisation** (name, optional slug, first admin's name/email/temporary password) — the admin then signs in and sets up their company profile, values, consent and users.
- **Enter** an organisation to act as its admin (amber banner: *You are acting as an administrator of …*, with *Return to your organisation*); entering is audited.
- **Suspend / reactivate**: suspended organisations' staff can't sign in and their API keys stop working; candidates already in process are not cut off.
- **AI models (all organisations):** the per-stage model and interviewer-effort overrides moved here from organisation settings.
- **Budget alerts:** organisation admins see a banner at 80% and 100% of the monthly budget, and *AI usage* shows month-to-date spend vs budget. Interviews are never blocked.

### 19.3 AWS Lambda code execution

- Select with `CODE_EXECUTOR=aws-lambda`; Judge0 remains the default. Same languages (Python, JavaScript, Java, C++), same verdicts, same 3-second CPU limit per test, same sample/hidden test behaviour — candidates see no difference.
- Isolation: a container in a VPC with no internet route and no outbound rules, bounded memory, timeout and concurrency; each run in a fresh directory in its own process group; after each run every stray process is killed and `/tmp` emptied.
- Deployment: build the image (`infra/aws-executor/Dockerfile`), push to ECR, deploy `template.yaml`, create an access key for the stack's invoke-only user, set the environment variables, run `scripts/check-aws-executor.ts`. See `infra/aws-executor/README.md`.

### 19.4 HR knowledge-base search

- Knowledge bases up to ~60,000 characters are given to the HR interviewer whole (as before). Larger ones are split into passages and searched: for each candidate message the five most relevant passages are given to the interviewer, which answers only from them and cites the document; otherwise it logs the question for HR.
- Works across languages (e.g. a Hindi policy answers a Hindi question).
- **Settings → HR knowledge base → Try a candidate question** previews which passages would be used; the card says when the KB is in search mode.

### 19.5 Whiteboard in exports

- The PDF/print export includes the system-design whiteboard image. Identity-masked exports leave it out (a drawing can't be scrubbed of names) and say so.

### 19.6 Still out of scope

| Item | Why |
|---|---|
| Private repositories (D-3) | Decision §11-4 (public only) |
| Identity verification / face matching | Biometric data (§18.5) |
| Demographic bias audits | No protected data is collected (§18.7) |
| Postgres row-level security | Isolation is enforced in the application and verified route by route; RLS is a later defence-in-depth option |
| Per-organisation custom domains / branding beyond company name | Not requested yet |

---

## 20. Phase 5 features (v1.6)

### 20.1 Sign-in security

- **Throttling & lockout:** at most 10 sign-in attempts per account and 100 per network address per 15 minutes (counters shared by all app instances). Five wrong passwords lock the account for 15 minutes; locks and failures are audited. Messages never reveal whether an account exists.
- **Password policy** (new users, resets, password changes, first admins): at least 10 characters; not a common password; not containing the person's email name or name; mix letters with numbers/symbols, or use a 16+ character passphrase.
- **Session revocation:** changing a password, a role change, deactivation or a 2FA reset signs the user out everywhere (the current session survives your own password change). **Security → Sign out everywhere** ends all sessions including the current one.
- **Cross-site protection:** session cookies are SameSite=Lax and every staff API rejects requests whose Origin isn't the app's own.
- **Headers:** Content-Security-Policy (self + the code-editor CDN; no plugins, no framing), X-Frame-Options DENY, nosniff, a strict referrer policy (candidate links never leak to other sites), Permissions-Policy (camera/microphone for this site only), HSTS in production.

### 20.2 Two-factor sign-in

- **Security page** (click your name): scan a QR code with any authenticator app (or type the key), confirm a 6-digit code, save 10 one-time recovery codes. Codes allow ±30 s of clock drift and can't be replayed.
- **Signing in:** password, then a code (or a recovery code; you're warned when ≤ 2 remain). New recovery codes and turning 2FA off need your password.
- **Organisation enforcement:** *Settings → Compliance & privacy → Require two-factor sign-in* (the admin must have it on first). Staff without it are taken to the Security page and can't use anything else until they enrol; it can't be turned off while required.
- **Lost phone:** an admin clicks **Reset 2FA** on the user (Settings → Users); the user is signed out and enrols again.
- Secrets are encrypted at rest (AES-256-GCM).

### 20.3 Audit log

- **Audit** (admins): every sign-in, failed sign-in and lock, user/role change, drive change, invite, consent, report view/export, override, gate decision, share link, API key, webhook, organisation switch, data request and job action — filter by category, staff member, period and free text; links to the candidate or drive; paginated.
- **Export CSV** with the same filters (cells that look like spreadsheet formulas are neutralised). Exports are themselves audited.

### 20.4 Candidate data rights

- **Your data** on the candidate's page (after consent): **Download my data** — a JSON file with their profile, resume text and parsed profile, consent record, repositories, transcripts, written answers, whiteboard, code they ran/submitted, practical details, survey answers and any released feedback. Internal evaluations (scores, recruiter notes) aren't included; the organisation provides them on request.
- **Delete my data…** (with an optional reason) creates a request due in **30 days**; the candidate sees its status. Admins see a banner and a notice on the candidate page; **Data requests** lists them: **Delete now** or **Decline…** with a reason (e.g. legal hold), which is emailed to the candidate. Requests still pending at the due date are fulfilled automatically.
- Deletion removes the candidacy (resume, transcripts, code, reports, snapshots…); the candidate's email, dates and outcome are kept as proof the request was handled.

### 20.5 Operations (platform admins)

- **Platform → Operations:** job worker status (heartbeat), jobs due, oldest waiting job, running, retrying, failed in 24 h; counts by job type; failed jobs with error and payload, **Retry** or **Discard**.
- **/api/health** now reports the worker heartbeat and queue lag for uptime monitors (alert if the worker hasn't been seen for 2 minutes or a job has waited over 5 minutes). Completed jobs are kept 7 days, failed jobs 30 days.

### 20.6 Accessibility

- Automated WCAG 2.1 A/AA checks (axe-core) over 19 staff and candidate screens including the interview lobby and live room (`e2e/a11y-check.ts`): form controls are labelled, charts expose their values to screen readers, text meets 4.5:1 contrast, links in running text are underlined, alerts are announced.

### 20.7 Not built yet

| Item | Note |
|---|---|
| Single sign-on (SAML / OIDC with Google Workspace or Microsoft Entra) | OIDC built in Phase 6 (§21); SAML still out |
| Postgres row-level security | Isolation stays application-enforced and tested route by route |
| Per-organisation branding / custom domains | Branding built in Phase 6 (§21); custom domains still out |

---

## 21. Phase 6 features (v1.7)

### 21.1 Email domains

- **Settings → Single sign-on → Email domains** (admins): add the company's domain (e.g. `acme.com`). Public mail providers (gmail.com, outlook.com, yahoo.com, …) are refused, and a domain can belong to only one organisation.
- **Verify** by publishing a DNS TXT record `hbe-verification=<token>` on the domain, then clicking **Verify**. A platform admin can also confirm a domain when DNS access is slow; the audit log records which way it was verified.
- Only verified domains route people to their organisation's identity provider. Removing a domain stops that routing immediately.

### 21.2 Single sign-on (OpenID Connect)

- **Setup:** the admin registers HBE Interview as a web application in their identity provider (Google Workspace, Microsoft Entra ID, Okta, Auth0, Keycloak or any OIDC provider) with the redirect URI shown on the card (`<APP_BASE_URL>/api/auth/sso/callback`), then enters the **issuer URL**, **client ID** and **client secret**. The secret is encrypted at rest and never shown again (leave blank to keep it). Microsoft Entra needs the tenant-specific issuer (`https://login.microsoftonline.com/<tenant-id>/v2.0`).
- **Saving** fetches the provider's discovery document; a wrong issuer, an unreachable provider or an internal network address is refused with a clear message. SSO can be switched on only once at least one domain is verified.
- **Test sign-in** runs the whole flow against the admin's own account and returns to Settings with the result, without changing the current session. A successful test is required before SSO can be made mandatory.
- **Signing in:** on the sign-in page, **Sign in with single sign-on** → work email → the organisation's identity provider → back into HBE Interview. Entering a password for an SSO-required account switches to the SSO step.
- **Who gets in:** the identity provider must vouch for the email address (verified email claim; Entra by tenant). An existing active account in the same organisation signs in; accounts in another organisation, deactivated accounts and suspended organisations are refused.
- **Just-in-time accounts** (off by default): pick a role (recruiter, hiring manager or viewer) and anyone from a verified domain who passes the identity provider gets an account with that role on first sign-in. Admins are never created this way.
- **Require SSO:** password sign-in is blocked for the organisation's staff. Platform admins keep password sign-in as a break-glass in case the provider is down or misconfigured.
- **Two-factor:** an SSO session satisfies the organisation's *Require two-factor sign-in* setting, because the identity provider applies its own MFA policy. Password sign-ins still need the TOTP code.
- **Security:** authorisation code flow with PKCE (S256), state and nonce held in a signed, single-use, 10-minute cookie; ID-token signature (provider's published keys), issuer, audience, expiry and nonce checked. Sign-ins, test sign-ins, refusals and configuration changes are audited; the start endpoint is rate-limited.

### 21.3 Branding

- **Settings → Branding** (admins): upload a logo (PNG or JPEG, up to 200 KB; SVG is refused because it can carry scripts) and pick a brand colour. Colours that don't reach 4.5:1 contrast with white text are refused with a suggested darker shade, and a live preview shows the result.
- The logo and colour appear on everything candidates see: the candidate hub (`/c/…`), open registration pages (`/i/…`) and the interview room. Buttons, links and highlights use the brand colour; a small "Interview powered by HBE Interview" line stays at the foot of the page. Staff pages keep the HBE Interview look.
- Organisations without branding look exactly as before; one organisation's branding never shows on another's pages.

### 21.4 Not built yet

| Item | Note |
|---|---|
| SAML 2.0 | OIDC covers Google, Entra, Okta and most providers; SAML only on request (needs XML signature handling) |
| SCIM user provisioning / deprovisioning | Just-in-time creation only; leavers are deactivated in Settings → Users or blocked at the provider |
| Custom domains for candidate links | Candidate links stay on the app's own domain |
| Branded emails | Invitation and reminder emails carry the organisation name, not the logo |

---

## 22. Phase 7 features (v1.8)

### 22.1 Blind calibration reviews

- **Which rounds:** *Settings → Compliance & privacy*: a percentage of evaluated rounds (default 10%) is picked at random, plus (on by default) every evaluation the AI marked **low confidence**. A hiring manager or above can also click **Ask for a blind review** on any round in a candidate report. Picking is deterministic per round, so re-evaluating doesn't re-roll it.
- **Calibration → Waiting for a blind review** lists the picked rounds from drives the person can see. The review page shows the role, the rubric (each parameter's description and 1/3/5 anchors), the transcript, the final code (with hidden-test results), written answers and the whiteboard. The AI's scores, recommendation, summary, justifications and flags are hidden, and the candidate appears as *Candidate 1A2B3C*.
- **Scoring:** 1–5 per weighted parameter (or *Not enough evidence*), an overall recommendation and optional notes. Each person reviews a round once. After submitting, the reviewer sees their scores beside the AI's.
- **Blind or not:** if the reviewer had already opened the candidate's full report, the review is saved as *not blind*. Statistics use blind reviews only unless switched.
- **Disagreement:** a gap of 2+ points on any parameter, or the reviewer and the AI on different sides of the hire line (Strong Hire/Hire vs Lean No/No Hire). The candidate report shows each review (agreed/disagreed, scores side by side, notes) to hiring managers and above. *Decisions* marks candidates with a disagreeing review.
- Reviews freeze the AI's own scores (before any human override) and the evaluator version at the time of review. Reviewing never changes the candidate's scores or stage; overrides remain a separate, audited action.

### 22.2 Calibration dashboard

- **Calibration** (recruiters and admins; hiring managers see the queue only), filterable by 30/90/365 days and by round. It shows:
  - reviews and disagreement rate;
  - per round and parameter: pairs, AI average, reviewer average, *AI − people* (positive means the AI is more generous), exact agreement, within-one-point agreement and quadratic weighted kappa;
  - a recommendation confusion matrix with exact and same-side-of-the-hire-line rates;
  - the same statistics by evaluator model and prompt version;
  - the latest disagreements, with links.
- **Drift alerts:** with 10+ reviews, a parameter alerts when the AI is within one point of reviewers less than 80% of the time, or when the average gap reaches 0.5 points. The suggested actions are rubric weights, manual gates for that round, or an evaluator review.
- **Export CSV:** one row per parameter scored, with both scores, both recommendations, the evaluator version and the blind flag (formula-safe cells; audited).

### 22.3 Candidate accommodations

- **Requesting:** after consent, while rounds are still ahead, the candidate page offers *Adjustments for your interview*:
  - extra time: 25%, 50% or double;
  - extra breaks: 4 pauses of up to 10 minutes instead of 2 of 2 minutes;
  - a free-text note.
  The candidate is told that a diagnosis isn't needed and that the request never reaches the AI or the evaluation. They see its status, and changing a request sends it back for a decision.
- **Deciding:** recruiters and admins see pending requests on *Decisions* and in the candidate report. They can approve as asked or with a different amount, or decline (a note to the candidate is required). The candidate is emailed either way.
- **Privacy:** the request is visible only to recruiters and admins. Hiring managers and viewers see nothing, not even that a request exists. The audit log records that a request or decision happened, never its text. The request is in the candidate's data download and is deleted with the candidacy.
- **Effect:** applies to rounds started after approval. The round clock and every section's time budget are multiplied by the extra-time factor, the pause allowance is extended, and the lobby states the adjustment. Rounds already started keep the timing they started with. Recruiters see an *adjusted timing* badge on such rounds. Scores aren't adjusted, because the rubric judges the content of answers, not speed.

### 22.4 Not built yet

| Item | Note |
|---|---|
| Hold auto-advance until a sampled round is reviewed | Today sampling is retrospective; set the drive's gate to manual for the same effect |
| Agreement between people (two reviewers on the same round) | Several people can review a round, but only AI–human agreement is reported |
| Automatic evaluator recalibration | Drift is surfaced to people; the rubric and prompts are changed deliberately |

---

## 23. Phase 8 features (v1.9)

### 23.1 Arranging a panel interview

- **Who and when:** recruiters and admins, once the AI rounds are finished (candidate *Completed*, *Shortlisted* or *On hold*). Use *Arrange a panel interview…* on the candidate report.
- **Form fields:**
  - title, length (15–240 minutes), and where (video link or address);
  - **1–5 times** in the recruiter's own time zone, stored in UTC;
  - the **panel**: active recruiters, admins, and hiring managers assigned to the drive (viewers and unassigned hiring managers are refused);
  - **scorecard competencies**: up to 8, suggested from the role, for example *Technical depth, Problem solving, System design, Leadership, Communication, Collaboration, Motivation & role fit*.
- **Booking:** offering one time books it straight away. Offering several emails the candidate to choose. The candidate moves to the **Panel interview** stage.
- **Candidate side:** the interview page lists the offered times in the candidate's own time zone. The candidate confirms one, or says *None of these times work for me* with their availability. Once booked, the page shows the time, the place and an **Add to calendar (.ics)** link. *Can't make it? Ask for another time* releases the booking. The candidate never sees panel names.
- **Rescheduling:** requests appear on *Decisions → Panel interviews to reschedule* with the candidate's message. *Offer new times* sends fresh options (or books a single time). *Cancel interview* records a reason in the audit log and tells the candidate.
- **Calendar files:** every change bumps the event's sequence number, so calendar apps update the existing entry rather than adding a new one. A cancellation produces a cancelled event. Panelists get emails and a calendar file linking to their kit.

### 23.2 Interview kit and scorecards

- **My interviews** lists each panelist's upcoming and past interviews, with any scorecard that's due.
- **The kit:** time, place, the panel and who has submitted, plus the AI's combined recommendation, summary, focus areas and risks to probe, and questions the candidate asked that need a person. A link opens the full report.
- **Scorecard:** each competency rated 1–5 (or *Not assessed*), an overall recommendation, and strengths and concerns with evidence.
  - It opens when the interview starts.
  - It can be updated until the final decision, then it locks.
  - Only panelists can submit.
- **Independence:** a panelist can't see other panelists' scorecards, on the kit or the report, until they've submitted their own. They can see who has submitted. People not on the panel see everything they otherwise have access to.
- **Reminders:** a panelist whose scorecard is still open 24 hours after the interview ends gets one reminder email.

### 23.3 Debrief and final decision

- **Report section:** *Panel interviews & final decision* shows each interview with ratings side by side per panelist, averages, and every recommendation. The consensus is the most common recommendation, with ties going to the more cautious one.
- **Panel split:** flagged when recommendations fall on both sides of the hire line, or any competency's ratings differ by 2 or more.
- **Decision** (hiring managers and above): *Make an offer*, *Reject* or *Hold*, with reasoning of at least 10 characters. A warning appears if scorecards are missing.
  - The decision records its **basis**: the AI combined recommendation and score, and each panel's consensus, hire votes, completeness and split.
  - Stage changes to **Offer**, **Rejected** or **On hold**.
  - It is audited, and the webhook `candidate.decided` fires.
- **Telling the candidate:** optional, ticked by default. An offer shows "Good news!" on the candidate's page and sends an email. A rejection sends a courteous, non-specific message. A hold is never sent. Untick it to tell them personally.
- **Analytics:** the drive funnel now counts *Shortlisted or in panel* and *Offer*.

### 23.4 Not built yet

| Item | Note |
|---|---|
| Calendar sync (free/busy from Google or Microsoft 365) | Recruiters pick times; candidates choose. Needs calendar OAuth credentials |
| Creating the video meeting automatically | Paste any meeting link |
| Offer letters, approvals and e-signature | Decision is recorded here; the offer itself is handled in your HR system (webhook) |
