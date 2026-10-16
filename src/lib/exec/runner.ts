/**
 * Sandboxed test runner shared by the local-dev executor and the AWS Lambda executor (infra/aws-executor).
 * Pure Node: no app imports, so it bundles standalone into the Lambda image.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export type Language = "python" | "javascript" | "java" | "cpp";
export type Verdict = "AC" | "WA" | "TLE" | "RE" | "CE" | "ERR";
export interface TestCase {
  input: string;
  output: string;
}
export interface TestResult {
  verdict: Verdict;
  stdout: string;
  stderr: string;
  timeMs: number | null;
}

export const LANGUAGES: Language[] = ["python", "javascript", "java", "cpp"];

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

function runProcess(cmd: string, args: string[], opts: { cwd: string; input?: string; timeoutMs: number }): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean; ms: number }> {
  return new Promise((resolve) => {
    const started = Date.now();
    const childEnv = { PATH: process.env.PATH ?? "", HOME: opts.cwd, TMPDIR: opts.cwd } as unknown as NodeJS.ProcessEnv;
    // Own process group, so a timeout or the end of the run kills anything the program spawned.
    const child = spawn(cmd, args, { cwd: opts.cwd, env: childEnv, stdio: ["pipe", "pipe", "pipe"], detached: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const killGroup = () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, opts.timeoutMs);
    child.stdout.on("data", (d) => {
      if (stdout.length < 1_000_000) stdout += d;
    });
    child.stderr.on("data", (d) => {
      if (stderr.length < 100_000) stderr += d;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      killGroup();
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

/** Compile (if needed) and run `code` against each test in a fresh temporary directory, which is removed afterwards. */
export async function runTests(language: Language, code: string, tests: TestCase[], cpuSec = 3): Promise<TestResult[]> {
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
      const c = await runProcess("javac", ["-J-Xmx256m", "Main.java"], { cwd: dir, timeoutMs: 30_000 });
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
      const r = await runProcess(cmd, args, { cwd: dir, input: t.input, timeoutMs: cpuSec * 1000 * (language === "java" ? 2 : 1) });
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
