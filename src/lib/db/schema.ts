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

/* ---------------------------------- Staff --------------------------------- */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().$type<"admin" | "recruiter" | "hiring_manager" | "viewer">(),
  active: boolean("active").notNull().default(true),
  /** Drives a hiring manager is assigned to (hiring managers only see these). */
  driveIds: jsonb("drive_ids").$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
});

/** Single-row-per-key org settings (company profile, values, policies). */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
});

/** HR knowledge base documents / FAQ entries used by the HR round's policy Q&A. */
export const kbDocuments = pgTable("kb_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* --------------------------------- Drives --------------------------------- */

export const drives = pgTable("drives", {
  id: uuid("id").primaryKey().defaultRandom(),
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

export const candidates = pgTable("candidates", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  githubUsername: text("github_username"),
  createdAt: createdAt(),
});

export const candidacies = pgTable(
  "candidacies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
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
  sessionId: uuid("session_id"),
  candidacyId: uuid("candidacy_id"),
  error: text("error"),
  createdAt: createdAt(),
});

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
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
