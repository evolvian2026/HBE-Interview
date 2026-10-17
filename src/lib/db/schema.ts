import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  real,
  boolean,
  bigserial,
  customType,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();

/* ------------------------------ Organisations ----------------------------- */

/** A tenant. Every drive, user, candidate, setting, key and webhook belongs to exactly one organisation. */
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  status: text("status").notNull().default("active").$type<"active" | "suspended">(),
  /** Optional monthly AI spend alert threshold in USD (estimate). */
  aiBudgetUsd: real("ai_budget_usd"),
  /** Branding on candidate pages (v1.7): logo image and primary colour (#rrggbb, contrast-checked against white). */
  logo: bytea("logo"),
  logoMime: text("logo_mime"),
  brandColor: text("brand_color"),
  createdAt: createdAt(),
});

const orgRef = () => uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" });

/* ---------------------------------- Staff --------------------------------- */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: orgRef(),
  /** Platform operators can create organisations and switch into any of them. */
  platformAdmin: boolean("platform_admin").notNull().default(false),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().$type<"admin" | "recruiter" | "hiring_manager" | "viewer">(),
  active: boolean("active").notNull().default(true),
  /** Bumped to revoke every session of the user (password change, deactivation, role change, 2FA reset). */
  sessionVersion: integer("session_version").notNull().default(0),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: ts("locked_until"),
  /** TOTP secret, AES-256-GCM encrypted with a key derived from SESSION_SECRET. */
  totpSecret: text("totp_secret"),
  totpEnabledAt: ts("totp_enabled_at"),
  /** Last accepted TOTP time step — a code can't be replayed within its window. */
  totpLastStep: integer("totp_last_step"),
  /** SHA-256 hashes of unused one-time recovery codes. */
  recoveryCodes: jsonb("recovery_codes").$type<string[]>().notNull().default([]),
  passwordChangedAt: ts("password_changed_at"),
  /** Drives a hiring manager is assigned to (hiring managers only see these). */
  driveIds: jsonb("drive_ids").$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
});

/** Settings rows: key `org:{orgId}` holds an organisation's settings; key `platform` holds platform-wide ones. */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
});

/** HR knowledge base documents / FAQ entries used by the HR round's policy Q&A. */
export const kbDocuments = pgTable("kb_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: orgRef(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* --------------------------------- Drives --------------------------------- */

export const drives = pgTable("drives", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: orgRef(),
  title: text("title").notNull(),
  status: text("status").notNull().default("draft").$type<"draft" | "active" | "paused" | "closed">(),
  draft: jsonb("draft").notNull(),
  currentVersionId: uuid("current_version_id"),
  openSlug: text("open_slug").notNull().unique(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const driveVersions = pgTable("drive_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  driveId: uuid("drive_id").notNull().references(() => drives.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  config: jsonb("config").notNull(),
  createdAt: createdAt(),
});

/* ------------------------------- Candidates ------------------------------- */

/** A person, per organisation (the same email in two organisations is two separate records). */
export const candidates = pgTable(
  "candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgRef(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    githubUsername: text("github_username"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("candidate_org_email").on(t.orgId, t.email)],
);

export const candidacies = pgTable(
  "candidacies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Denormalised from the drive so every candidate-scoped check is a single comparison. */
    orgId: orgRef(),
    driveId: uuid("drive_id").notNull().references(() => drives.id, { onDelete: "cascade" }),
    driveVersionId: uuid("drive_version_id").notNull().references(() => driveVersions.id),
    candidateId: uuid("candidate_id").notNull().references(() => candidates.id, { onDelete: "cascade" }),
    /** Bearer token embedded in the candidate's personal link (/c/{token}). */
    accessToken: text("access_token").notNull().unique(),
    stage: text("stage").notNull().default("invited"),
    currentRoundIndex: integer("current_round_index").notNull().default(0),
    consent: jsonb("consent"),
    expiresAt: ts("expires_at"),
    roundAvailableUntil: ts("round_available_until"),
    reminderSentAt: ts("reminder_sent_at"),
    /** Candidate-facing feedback summary, released by a recruiter (I-9). */
    feedbackSummary: jsonb("feedback_summary"),
    feedbackReleasedAt: ts("feedback_released_at"),
    finalStatus: text("final_status"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("candidacy_drive_candidate").on(t.driveId, t.candidateId), index("candidacy_stage").on(t.driveId, t.stage)],
);

export const candidacyNotes = pgTable("candidacy_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  candidacyId: uuid("candidacy_id").notNull().references(() => candidacies.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id),
  text: text("text").notNull(),
  createdAt: createdAt(),
});

export const resumes = pgTable("resumes", {
  id: uuid("id").primaryKey().defaultRandom(),
  candidacyId: uuid("candidacy_id").notNull().unique().references(() => candidacies.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  fileData: bytea("file_data").notNull(),
  rawText: text("raw_text"),
  status: text("status").notNull().default("uploaded").$type<"uploaded" | "parsing" | "parsed" | "failed" | "confirmed">(),
  error: text("error"),
  parsed: jsonb("parsed"),
  edits: jsonb("edits"),
  jdMatch: jsonb("jd_match"),
  claims: jsonb("claims"),
  riskSignals: jsonb("risk_signals"),
  ocrUsed: boolean("ocr_used").notNull().default(false),
  confirmedAt: ts("confirmed_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const repositories = pgTable("repositories", {
  id: uuid("id").primaryKey().defaultRandom(),
  candidacyId: uuid("candidacy_id").notNull().references(() => candidacies.id, { onDelete: "cascade" }),
  projectName: text("project_name").notNull(),
  url: text("url"),
  notPublicReason: text("not_public_reason"),
  status: text("status").notNull().default("queued").$type<"queued" | "analyzing" | "ready" | "failed" | "skipped">(),
  error: text("error"),
  analysis: jsonb("analysis"),
  questions: jsonb("questions"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* -------------------------------- Interview ------------------------------- */

export const roundSessions = pgTable(
  "round_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidacyId: uuid("candidacy_id").notNull().references(() => candidacies.id, { onDelete: "cascade" }),
    roundIndex: integer("round_index").notNull(),
    roundType: text("round_type").notNull().$type<"technical" | "managerial" | "hr">(),
    status: text("status").notNull().default("lobby"),
    endReason: text("end_reason"),
    mode: text("mode").notNull().default("text").$type<"text" | "voice">(),
    language: text("language").notNull().default("en"),
    state: jsonb("state").notNull(),
    startedAt: ts("started_at"),
    endedAt: ts("ended_at"),
    deadlineAt: ts("deadline_at"),
    lastHeartbeatAt: ts("last_heartbeat_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("session_candidacy_round").on(t.candidacyId, t.roundIndex)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").notNull().references(() => roundSessions.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    role: text("role").notNull().$type<"ai" | "candidate" | "system">(),
    sectionKey: text("section_key").notNull(),
    content: text("content").notNull(),
    clientMsgId: text("client_msg_id"),
    meta: jsonb("meta"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("message_client_id").on(t.sessionId, t.clientMsgId), index("message_seq").on(t.sessionId, t.seq)],
);

export const assessments = pgTable("assessments", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull().references(() => roundSessions.id, { onDelete: "cascade" }),
  messageId: uuid("message_id"),
  sectionKey: text("section_key").notNull(),
  parameter: text("parameter").notNull(),
  score: integer("score").notNull(),
  evidence: text("evidence").notNull(),
  needsFollowUp: boolean("needs_follow_up").notNull().default(false),
  star: jsonb("star"),
  createdAt: createdAt(),
});

export const codeRuns = pgTable("code_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull().references(() => roundSessions.id, { onDelete: "cascade" }),
  problemId: text("problem_id").notNull(),
  kind: text("kind").notNull().$type<"run" | "submit" | "snapshot">(),
  language: text("language").notNull(),
  code: text("code").notNull(),
  results: jsonb("results"),
  createdAt: createdAt(),
});

export const exerciseResponses = pgTable(
  "exercise_responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").notNull().references(() => roundSessions.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    refId: text("ref_id").notNull(),
    content: jsonb("content").notNull(),
    /** System-design whiteboard (F-10): vector shapes + rendered PNG shown to the interviewer and evaluator. */
    whiteboard: jsonb("whiteboard"),
    whiteboardPng: bytea("whiteboard_png"),
    submittedAt: ts("submitted_at"),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("exercise_session_kind").on(t.sessionId, t.kind)],
);

export const practicalFit = pgTable("practical_fit", {
  candidacyId: uuid("candidacy_id").primaryKey().references(() => candidacies.id, { onDelete: "cascade" }),
  data: jsonb("data").notNull(),
  compatibility: jsonb("compatibility"),
  confirmedAt: ts("confirmed_at"),
  updatedAt: updatedAt(),
});

export const integrityEvents = pgTable("integrity_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull().references(() => roundSessions.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  payload: jsonb("payload"),
  createdAt: createdAt(),
});

/* ------------------------------- Evaluation ------------------------------- */

export const roundReports = pgTable("round_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull().unique().references(() => roundSessions.id, { onDelete: "cascade" }),
  candidacyId: uuid("candidacy_id").notNull().references(() => candidacies.id, { onDelete: "cascade" }),
  roundIndex: integer("round_index").notNull(),
  roundType: text("round_type").notNull(),
  status: text("status").notNull().default("pending").$type<"pending" | "ready" | "failed">(),
  params: jsonb("params"),
  roundScore: real("round_score"),
  recommendation: text("recommendation"),
  confidence: text("confidence"),
  summary: text("summary"),
  strengths: jsonb("strengths"),
  concerns: jsonb("concerns"),
  roundSpecific: jsonb("round_specific"),
  knockouts: jsonb("knockouts"),
  runs: jsonb("runs"),
  versions: jsonb("versions"),
  error: text("error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const scoreOverrides = pgTable("score_overrides", {
  id: uuid("id").primaryKey().defaultRandom(),
  reportId: uuid("report_id").notNull().references(() => roundReports.id, { onDelete: "cascade" }),
  parameter: text("parameter").notNull(),
  oldScore: integer("old_score"),
  newScore: integer("new_score").notNull(),
  reason: text("reason").notNull(),
  userId: uuid("user_id").references(() => users.id),
  createdAt: createdAt(),
});

export const gateDecisions = pgTable("gate_decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  candidacyId: uuid("candidacy_id").notNull().references(() => candidacies.id, { onDelete: "cascade" }),
  fromRoundIndex: integer("from_round_index").notNull(),
  decision: text("decision").notNull().$type<"advance" | "hold" | "reject">(),
  mode: text("mode").notNull().$type<"auto" | "manual">(),
  decidedBy: uuid("decided_by").references(() => users.id),
  reason: text("reason"),
  createdAt: createdAt(),
});

export const combinedReports = pgTable("combined_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  candidacyId: uuid("candidacy_id").notNull().unique().references(() => candidacies.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending").$type<"pending" | "ready" | "failed">(),
  finalScore: real("final_score"),
  recommendation: text("recommendation"),
  confidence: text("confidence"),
  partial: boolean("partial").notNull().default(false),
  data: jsonb("data"),
  error: text("error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* -------------------------------- Platform -------------------------------- */

export const jobs = pgTable(
  "jobs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("queued").$type<"queued" | "running" | "done" | "failed">(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAt: ts("run_at").notNull().defaultNow(),
    lockedAt: ts("locked_at"),
    lastError: text("last_error"),
    singletonKey: text("singleton_key"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("jobs_pick").on(t.status, t.runAt), uniqueIndex("jobs_singleton").on(t.singletonKey)],
);

export const aiCalls = pgTable("ai_calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  stage: text("stage").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  cacheReadTokens: integer("cache_read_tokens"),
  cacheWriteTokens: integer("cache_write_tokens"),
  latencyMs: integer("latency_ms"),
  orgId: uuid("org_id"),
  sessionId: uuid("session_id"),
  candidacyId: uuid("candidacy_id"),
  error: text("error"),
  createdAt: createdAt(),
});

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id"),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id"),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  data: jsonb("data"),
  createdAt: createdAt(),
});

/* ------------------------------- Phase 2 ---------------------------------- */

/** Expiring, read-only links to a candidate report for people without an account. */
export const shareLinks = pgTable("share_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  candidacyId: uuid("candidacy_id").notNull().references(() => candidacies.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  passcodeHash: text("passcode_hash"),
  masked: boolean("masked").notNull().default(true),
  expiresAt: ts("expires_at").notNull(),
  revokedAt: ts("revoked_at"),
  views: integer("views").notNull().default(0),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
});

/** Custom coding problems authored by recruiters, validated against a reference solution before use. */
export const codingProblems = pgTable("coding_problems", {
  id: text("id").primaryKey(),
  driveId: uuid("drive_id").references(() => drives.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  difficulty: text("difficulty").notNull().$type<"easy" | "medium" | "hard">(),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  statement: text("statement").notNull(),
  samples: jsonb("samples").$type<{ input: string; output: string }[]>().notNull(),
  hidden: jsonb("hidden").$type<{ input: string; output: string }[]>().notNull(),
  referenceLanguage: text("reference_language").notNull(),
  referenceCode: text("reference_code").notNull(),
  validatedAt: ts("validated_at"),
  validation: jsonb("validation"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ------------------------------- Phase 3 ---------------------------------- */

/** API keys for the integrations REST API (only a SHA-256 hash is stored). */
export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: orgRef(),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
  createdBy: uuid("created_by").references(() => users.id),
  lastUsedAt: ts("last_used_at"),
  revokedAt: ts("revoked_at"),
  createdAt: createdAt(),
});

/** Outbound webhook endpoints (payloads are HMAC-SHA256 signed with the secret). */
export const webhooks = pgTable("webhooks", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: orgRef(),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  events: jsonb("events").$type<string[]>().notNull(),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
});

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  webhookId: uuid("webhook_id").notNull().references(() => webhooks.id, { onDelete: "cascade" }),
  event: text("event").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("pending").$type<"pending" | "delivered" | "failed">(),
  attempts: integer("attempts").notNull().default(0),
  responseStatus: integer("response_status"),
  error: text("error"),
  deliveredAt: ts("delivered_at"),
  createdAt: createdAt(),
});

/** Opt-in webcam snapshots (low-resolution JPEG) with an AI presence check — no face recognition. */
export const proctorSnapshots = pgTable("proctor_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull().references(() => roundSessions.id, { onDelete: "cascade" }),
  image: bytea("image").notNull(),
  mimeType: text("mime_type").notNull(),
  check: jsonb("check"),
  flagged: boolean("flagged").notNull().default(false),
  createdAt: createdAt(),
});

/** Post-interview candidate experience survey. */
export const candidateFeedback = pgTable("candidate_feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  candidacyId: uuid("candidacy_id").notNull().references(() => candidacies.id, { onDelete: "cascade" }),
  roundIndex: integer("round_index"),
  overall: integer("overall").notNull(),
  fairness: integer("fairness"),
  clarity: integer("clarity"),
  technical: integer("technical"),
  comment: text("comment"),
  createdAt: createdAt(),
});

/* ------------------------------- Phase 4 ---------------------------------- */

/** HR knowledge-base passages for full-text retrieval when the KB is too large to place whole in the dossier. */
export const kbChunks = pgTable(
  "kb_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgRef(),
    documentId: uuid("document_id").notNull().references(() => kbDocuments.id, { onDelete: "cascade" }),
    ord: integer("ord").notNull(),
    content: text("content").notNull(),
  },
  (t) => [index("kb_chunks_fts").using("gin", sql`to_tsvector('simple', ${t.content})`), index("kb_chunks_org").on(t.orgId)],
);

/* ------------------------------- Phase 5 ---------------------------------- */

/** Fixed-window counters shared by every app instance (login, 2FA, registration, share passcodes…). */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStart: ts("window_start").notNull().defaultNow(),
});

/** Candidate data-rights requests (deletion); exports are self-service and only audited. */
export const dataRequests = pgTable(
  "data_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgRef(),
    candidacyId: uuid("candidacy_id"),
    candidateEmail: text("candidate_email").notNull(),
    type: text("type").notNull().$type<"deletion">(),
    status: text("status").notNull().default("pending").$type<"pending" | "completed" | "rejected">(),
    reason: text("reason"),
    resolution: text("resolution"),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
    dueAt: ts("due_at").notNull(),
    resolvedAt: ts("resolved_at"),
    createdAt: createdAt(),
  },
  (t) => [index("data_requests_org_status").on(t.orgId, t.status)],
);

/* ------------------------------- Phase 6 ---------------------------------- */

/** Email domains an organisation has proven it controls (DNS TXT record, or confirmed by a platform admin). */
export const orgDomains = pgTable("org_domains", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: orgRef(),
  domain: text("domain").notNull().unique(),
  verificationToken: text("verification_token").notNull(),
  verifiedAt: ts("verified_at"),
  verifiedBy: text("verified_by").$type<"dns" | "platform">(),
  createdAt: createdAt(),
});

/** OpenID Connect single sign-on, one identity provider per organisation. */
export const ssoConfigs = pgTable("sso_configs", {
  orgId: uuid("org_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  issuer: text("issuer").notNull(),
  clientId: text("client_id").notNull(),
  /** AES-256-GCM sealed. */
  clientSecret: text("client_secret").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  /** Password sign-in refused for this organisation's users (platform admins keep it as break-glass). */
  required: boolean("required").notNull().default(false),
  /** Role given to people from a verified domain on first SSO sign-in; null = only existing users may sign in. */
  jitRole: text("jit_role").$type<"recruiter" | "hiring_manager" | "viewer">(),
  lastTestedAt: ts("last_tested_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

