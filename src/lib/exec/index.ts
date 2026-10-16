import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { env } from "../env";
import type { Language } from "../core/types";
import type { TestCase } from "../content";

export type Verdict = "AC" | "WA" | "TLE" | "RE" | "CE" | "ERR";

export interface TestResult {
  verdict: Verdict;
  stdout: string;
  stderr: string;
  timeMs: number | null;
}

export interface RunSummary {
  passed: number;
  total: number;
  results: (TestResult & { input?: string; expected?: string })[];
  compileError?: string;
  unavailable?: string;
}

/** Normalise program output for comparison: trim trailing whitespace on each line and trailing blank lines. */
export function normalizeOutput(s: string): string {
  return s
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n+$/, "")
    .trim();
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

function runProcess(cmd: string, args: string[], opts: { cwd: string; input?: string; timeoutMs: number }): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean; ms: number }> {
  return new Promise((resolve) => {
    const started = Date.now();
    const childEnv = { PATH: process.env.PATH ?? "" } as unknown as NodeJS.ProcessEnv;
    const child = spawn(cmd, args, { cwd: opts.cwd, env: childEnv, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);
    child.stdout.on("data", (d) => {
      if (stdout.length < 1_000_000) stdout += d;
    });
    child.stderr.on("data", (d) => {
      if (stderr.length < 100_000) stderr += d;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut, ms: Date.now() - started });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: String(e), timedOut, ms: Date.now() - started });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(opts.input ?? "");
  });
}

async function runLocal(language: Language, code: string, tests: TestCase[]): Promise<TestResult[]> {
  if (env.isProduction) throw new Error("The local-dev executor is disabled in production. Configure Judge0.");
  const dir = await mkdtemp(path.join(tmpdir(), "hbe-run-"));
  try {
    let cmd: string;
    let args: string[];
    if (language === "python") {
      await writeFile(path.join(dir, "main.py"), code);
      [cmd, args] = ["python3", ["-I", "main.py"]];
    } else if (language === "javascript") {
      await writeFile(path.join(dir, "main.js"), code);
      [cmd, args] = ["node", ["main.js"]];
    } else if (language === "java") {
      await writeFile(path.join(dir, "Main.java"), code);
      const c = await runProcess("javac", ["Main.java"], { cwd: dir, timeoutMs: 30_000 });
      if (c.code !== 0) return tests.map(() => ({ verdict: "CE" as const, stdout: "", stderr: c.stderr.slice(0, 4000), timeMs: null }));
      [cmd, args] = ["java", ["-Xmx256m", "Main"]];
    } else {
      await writeFile(path.join(dir, "main.cpp"), code);
      const c = await runProcess("g++", ["-O2", "-std=c++17", "-o", "main", "main.cpp"], { cwd: dir, timeoutMs: 30_000 });
      if (c.code !== 0) return tests.map(() => ({ verdict: "CE" as const, stdout: "", stderr: c.stderr.slice(0, 4000), timeMs: null }));
      [cmd, args] = ["./main", []];
    }
    const out: TestResult[] = [];
    for (const t of tests) {
      const r = await runProcess(cmd, args, { cwd: dir, input: t.input, timeoutMs: CPU_SEC * 1000 * (language === "java" ? 2 : 1) });
      let verdict: Verdict;
      if (r.timedOut) verdict = "TLE";
      else if (r.code !== 0) verdict = "RE";
      else verdict = normalizeOutput(r.stdout) === normalizeOutput(t.output) ? "AC" : "WA";
      out.push({ verdict, stdout: r.stdout.slice(0, 4000), stderr: r.stderr.slice(0, 4000), timeMs: r.ms });
    }
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/* ---------------------------------- API ----------------------------------- */

export async function executeTests(language: Language, code: string, tests: TestCase[], opts: { revealIO: boolean }): Promise<RunSummary> {
  if (code.length > MAX_CODE) return { passed: 0, total: tests.length, results: [], compileError: "Code is larger than 64 KB" };
  let results: TestResult[];
  try {
    results = env.codeExecutor === "local-dev" ? await runLocal(language, code, tests) : await runJudge0(language, code, tests);
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
