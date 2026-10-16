import { env } from "../env";
import type { Language } from "../core/types";
import type { TestCase } from "../content";
import { normalizeOutput, runTests, type TestResult, type Verdict } from "./runner";
import { runAwsLambda } from "./aws";

export { normalizeOutput };
export type { TestResult, Verdict };

export interface RunSummary {
  passed: number;
  total: number;
  results: (TestResult & { input?: string; expected?: string })[];
  compileError?: string;
  unavailable?: string;
}

const MAX_CODE = 64 * 1024;
const CPU_SEC = 3;

/* ---------------------------------- Judge0 --------------------------------- */

const DEFAULT_JUDGE0_IDS: Record<Language, number> = { python: 71, javascript: 63, java: 62, cpp: 54 };

function judge0Ids(): Record<Language, number> {
  if (!env.judge0LanguageIds) return DEFAULT_JUDGE0_IDS;
  try {
    return { ...DEFAULT_JUDGE0_IDS, ...JSON.parse(env.judge0LanguageIds) };
  } catch {
    return DEFAULT_JUDGE0_IDS;
  }
}

function judge0Headers(): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (env.judge0Key) {
    if (env.judge0RapidApiHost) {
      h["X-RapidAPI-Key"] = env.judge0Key;
      h["X-RapidAPI-Host"] = env.judge0RapidApiHost;
    } else {
      h["X-Auth-Token"] = env.judge0Key;
    }
  }
  return h;
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const unb64 = (s: string | null | undefined) => (s ? Buffer.from(s, "base64").toString("utf8") : "");

async function runJudge0(language: Language, code: string, tests: TestCase[]): Promise<TestResult[]> {
  const base = env.judge0Url.replace(/\/$/, "");
  const submissions = tests.map((t) => ({
    language_id: judge0Ids()[language],
    source_code: b64(code),
    stdin: b64(t.input),
    expected_output: b64(t.output),
    cpu_time_limit: CPU_SEC,
    wall_time_limit: CPU_SEC * 3,
    memory_limit: 256_000,
    enable_network: false,
  }));
  const res = await fetch(`${base}/submissions/batch?base64_encoded=true`, {
    method: "POST",
    headers: judge0Headers(),
    body: JSON.stringify({ submissions }),
  });
  if (!res.ok) throw new Error(`Judge0 submit failed: ${res.status} ${await res.text()}`);
  const tokens = ((await res.json()) as { token: string }[]).map((t) => t.token);
  const deadline = Date.now() + 30_000;
  for (;;) {
    await new Promise((r) => setTimeout(r, 800));
    const poll = await fetch(
      `${base}/submissions/batch?tokens=${tokens.join(",")}&base64_encoded=true&fields=status_id,stdout,stderr,compile_output,time`,
      { headers: judge0Headers() },
    );
    if (!poll.ok) throw new Error(`Judge0 poll failed: ${poll.status}`);
    const { submissions: subs } = (await poll.json()) as {
      submissions: { status_id: number; stdout: string | null; stderr: string | null; compile_output: string | null; time: string | null }[];
    };
    if (subs.every((s) => s.status_id >= 3) || Date.now() > deadline) {
      return subs.map((s, i) => {
        const stdout = unb64(s.stdout);
        let verdict: Verdict;
        if (s.status_id === 3) verdict = "AC";
        else if (s.status_id === 4) verdict = normalizeOutput(stdout) === normalizeOutput(tests[i].output) ? "AC" : "WA";
        else if (s.status_id === 5) verdict = "TLE";
        else if (s.status_id === 6) verdict = "CE";
        else if (s.status_id <= 2) verdict = "TLE";
        else if (s.status_id >= 7 && s.status_id <= 12) verdict = "RE";
        else verdict = "ERR";
        return {
          verdict,
          stdout: stdout.slice(0, 4000),
          stderr: (unb64(s.compile_output) + unb64(s.stderr)).slice(0, 4000),
          timeMs: s.time ? Math.round(Number(s.time) * 1000) : null,
        };
      });
    }
  }
}

/* ------------------------- Local executor (development) ------------------- */

async function runLocal(language: Language, code: string, tests: TestCase[]): Promise<TestResult[]> {
  if (env.isProduction) throw new Error("The local-dev executor is disabled in production. Configure Judge0 or AWS Lambda.");
  return runTests(language, code, tests, CPU_SEC);
}

/* ---------------------------------- API ----------------------------------- */

export async function executeTests(language: Language, code: string, tests: TestCase[], opts: { revealIO: boolean }): Promise<RunSummary> {
  if (code.length > MAX_CODE) return { passed: 0, total: tests.length, results: [], compileError: "Code is larger than 64 KB" };
  let results: TestResult[];
  try {
    results =
      env.codeExecutor === "local-dev"
        ? await runLocal(language, code, tests)
        : env.codeExecutor === "aws-lambda"
          ? await runAwsLambda(language, code, tests, CPU_SEC)
          : await runJudge0(language, code, tests);
  } catch (e) {
    console.error("code execution failed", e);
    return { passed: 0, total: tests.length, results: [], unavailable: "Code execution is temporarily unavailable." };
  }
  const compileError = results.find((r) => r.verdict === "CE")?.stderr;
  return {
    passed: results.filter((r) => r.verdict === "AC").length,
    total: tests.length,
    compileError,
    results: results.map((r, i) =>
      opts.revealIO
        ? { ...r, input: tests[i].input.slice(0, 2000), expected: tests[i].output.slice(0, 2000) }
        : { verdict: r.verdict, stdout: "", stderr: r.verdict === "RE" ? r.stderr.split("\n").slice(-3).join("\n") : "", timeMs: r.timeMs },
    ),
  };
}
