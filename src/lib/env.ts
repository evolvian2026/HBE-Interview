/** Centralised, typed access to environment configuration. */
function bool(v: string | undefined, def = false) {
  if (v === undefined || v === "") return def;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

export const env = {
  get databaseUrl() {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    return url;
  },
  appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000",
  get sessionSecret() {
    const s = process.env.SESSION_SECRET;
    if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set to at least 32 characters");
    return s;
  },
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD,
  aiMock: bool(process.env.AI_MOCK),
  anthropicKey: process.env.ANTHROPIC_API_KEY,
  aiFallbacks: bool(process.env.AI_FALLBACKS, true),
  models: {
    interviewer: process.env.AI_MODEL_INTERVIEWER ?? "claude-sonnet-5-5",
    analyzer: process.env.AI_MODEL_ANALYZER ?? "claude-sonnet-5-5",
    evaluator: process.env.AI_MODEL_EVALUATOR ?? "claude-opus-5-5",
    utility: process.env.AI_MODEL_UTILITY ?? "claude-haiku-5-5",
  },
  interviewerEffort: (process.env.AI_INTERVIEWER_EFFORT ?? "low") as "low" | "medium" | "high",
  codeExecutor: (process.env.CODE_EXECUTOR ?? "judge0") as "judge0" | "local-dev" | "aws-lambda",
  /** AWS Lambda executor (CODE_EXECUTOR=aws-lambda): function name/ARN, optional endpoint override (VPC endpoint or tests). */
  awsLambdaFunction: process.env.AWS_LAMBDA_FUNCTION ?? "",
  awsLambdaEndpoint: process.env.AWS_LAMBDA_ENDPOINT ?? "",
  aws: {
    region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "ap-south-1",
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
    sessionToken: process.env.AWS_SESSION_TOKEN || undefined,
  },
  judge0Url: process.env.JUDGE0_URL ?? "https://judge0-ce.p.rapidapi.com",
  judge0Key: process.env.JUDGE0_API_KEY,
  judge0RapidApiHost: process.env.JUDGE0_RAPIDAPI_HOST,
  judge0LanguageIds: process.env.JUDGE0_LANGUAGE_IDS,
  githubToken: process.env.GITHUB_TOKEN,
  runWorkerInProcess: bool(process.env.RUN_WORKER_IN_PROCESS, true),
  resendKey: process.env.RESEND_API_KEY,
  emailFrom: process.env.EMAIL_FROM ?? "HBE Interview <interviews@example.com>",
  isProduction: process.env.NODE_ENV === "production",
};
