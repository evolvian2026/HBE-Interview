# HBE Interview

An AI-powered, multi-round interview platform. Candidates upload a resume, link their GitHub projects, and are interviewed by an AI through up to three rounds — **Technical / Functional** (resume deep-dive, GitHub project validation, concepts, system design, live coding), **Managerial** (senior roles: leadership, stakeholders, execution, strategy, ethics scenarios, written case) and **HR** (motivation, company values, behaviours, practical details, policy Q&A). Each round produces an evidence-backed scorecard; a combined report recommends Strong Hire / Hire / Lean No / No Hire for a human to decide.

- Product requirements: [docs/PRD.md](docs/PRD.md)
- Feature specification: [docs/FEATURES.md](docs/FEATURES.md)
- Technical architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — see **§0 As-built decisions**

## Features (Phase 1)

| Area | What's included |
|---|---|
| Hiring drives | Paste a JD → AI role profile (category, seniority, track, skills) → recommended round pipeline by seniority, sections, timings, rubric weights, gates, coding languages, practical-fit band → publish (versioned) → open link or personal invites |
| Candidate onboarding | Consent (versioned), PDF/DOCX resume parsing, editable profile, claims-to-probe routed per round, JD match, GitHub repo links (public) |
| GitHub validation | Repo ingestion (tree, key files, commit attribution), deterministic authenticity signals (fork, commit share, history shape, volume, timeline), AI code summary and file-grounded questions shown to the candidate with snippets |
| Interview engine | Server-owned state machine (sections, timers, min/max questions, follow-up limits, wrap-up), Claude interviewer with validated tools, streaming over SSE, reconnect & idempotent retries, skip / pause / repeat, **text or voice** answers |
| Exercises | Monaco editor with Run (samples) / Submit (hidden tests) in Python, JavaScript, Java, C++ via Judge0; hints with score caps; system-design and written-case panels with autosave; HR practical-details form |
| Evaluation | Multi-pass evaluator (2 runs + tie-break, median), server-side evidence verification, PII/protected-info redaction, knockouts, confidence, gates (auto/manual/always), combined report with focus areas for the human panel, recruiter overrides with audit trail |
| Fairness & compliance | Protected-topic guardrails + HR compliance filter, integrity signals as context only, retention-based deletion, data deletion on request, salary history never asked (compensation off by default) |
| Phase 2 | Drive analytics, AI usage & cost, side-by-side comparison, PDF export (named / masked / with transcripts), expiring passcode-protected share links, code replay, drag-and-drop prioritisation exercise, inline snippet editor, AI-generated answer flags, template library, CSV invites, expiry reminders, custom coding problems validated by a reference solution, per-stage model overrides, re-evaluation, hiring-manager drive assignment |
| Recruiter app | Drives list, drive editor, candidate table with round/final scores, practical fit and integrity, decisions queue, full candidate report with transcripts, code and repo analysis, notes, settings (company values, HR knowledge base, consent, retention, users & roles) |

## Tech stack

Next.js 16 (App Router, TypeScript) · Tailwind CSS 4 · Neon Postgres + Drizzle ORM · Anthropic Claude (Sonnet 5.5 interviewer, Opus 5.5 evaluator, Haiku 5.5 utilities) · Judge0 · Monaco · Web Speech API · Render.

## Local development

Requirements: Node.js 22+, a Postgres database (local or a Neon branch), Python 3 / Node / Java / g++ only if you use the local code executor.

```bash
npm install
cp .env.example .env          # then edit values
npm run db:migrate            # create tables
npm run db:seed               # first admin from ADMIN_EMAIL/ADMIN_PASSWORD + sample HR policy
npm run dev                   # http://localhost:3000 → sign in with the admin account
```

**No API keys?** Set `AI_MOCK=true` (deterministic mock AI), `GITHUB_MOCK=true` (synthetic repository) and `CODE_EXECUTOR=local-dev` (runs code on your machine — development only; refused in production) to exercise the whole product offline.

### Configuration

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon connection string. Use the **direct** endpoint (host without `-pooler`) with `sslmode=require` — the interview engine uses session-level advisory locks |
| `APP_BASE_URL` | Public URL, used in candidate links and emails |
| `SESSION_SECRET` | ≥ 32 random characters for signing staff sessions |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | First admin, created on first boot / `db:seed` if no users exist |
| `ANTHROPIC_API_KEY` | Claude API key. Optional overrides: `AI_MODEL_INTERVIEWER`, `AI_MODEL_ANALYZER`, `AI_MODEL_EVALUATOR`, `AI_MODEL_UTILITY`, `AI_INTERVIEWER_EFFORT`, `AI_FALLBACKS` |
| `CODE_EXECUTOR` | `judge0` (default) or `local-dev` |
| `JUDGE0_URL`, `JUDGE0_API_KEY`, `JUDGE0_RAPIDAPI_HOST` | Judge0 CE (RapidAPI-hosted by default; leave the host empty for self-hosted with `X-Auth-Token`). `JUDGE0_LANGUAGE_IDS` overrides language ids, e.g. `{"python":92}` |
| `GITHUB_TOKEN` | Optional; raises GitHub's rate limit (public repos only) |
| `RUN_WORKER_IN_PROCESS` | `true` (default) runs background jobs inside the web server; set `false` and run `npm run worker` separately to scale them out |
| `RESEND_API_KEY`, `EMAIL_FROM` | Optional email for invites / next-round notices (links can always be copied from the app) |

## Deploying to Render + Neon

1. Create a Neon project and copy the **direct** connection string.
2. In Render, create a Blueprint from this repository (`render.yaml`) and fill in the secret env vars (`DATABASE_URL`, `APP_BASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ANTHROPIC_API_KEY`, `JUDGE0_API_KEY`, optionally `GITHUB_TOKEN`, `RESEND_API_KEY`).
3. Deploy. The start command applies migrations and seeds the first admin; `/api/health` is the health check.

## Testing

```bash
npm test             # unit tests: core domain logic, executor (4 languages), real Claude SDK path against a local stand-in
npm run typecheck
npm run smoke        # full HTTP run of all three rounds (server started with AI_MOCK=true GITHUB_MOCK=true CODE_EXECUTOR=local-dev)
SMOKE_ROLE=manager npm run smoke   # manager track (includes the prioritisation exercise)
npm run smoke:phase2 # analytics, usage, compare, print, share links, custom problems, hiring-manager scoping
npm run ui-check     # browser walkthrough with screenshots (Playwright; set CHROMIUM_PATH, CANDIDATE_LINK, RESUME_PATH)
```

## How it works (short)

1. **Recruiter** creates a drive from a JD; the AI proposes the profile and rounds (Managerial is enabled for Senior and above; HR is always last).
2. **Candidate** consents, uploads a resume (claims are extracted and routed to rounds), links public repos (analysed in the background).
3. Each **round** is driven by a server-side state machine; the AI interviewer proposes actions via tools (`record_assessment`, `advance_section`, `give_hint`, `end_interview`, …) which the server validates. Exercises open automatically in their sections.
4. When a round ends, the **evaluator** scores each parameter twice (a third time on disagreement), verifies every evidence quote against the transcript or code, applies knockouts and computes the round score; the **gate** auto-advances or waits for the recruiter.
5. After the last round, the **combined report** weights rounds by seniority and lists focus areas for the human panel. Recruiters can override any parameter with a reason.
