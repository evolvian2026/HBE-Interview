/**
 * AWS Lambda entry point for HBE Interview's code executor (CODE_EXECUTOR=aws-lambda).
 * Bundled with esbuild into the container image (see Dockerfile). Runs inside a VPC with no egress.
 */
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { LANGUAGES, runTests, type Language, type TestCase, type TestResult } from "../../src/lib/exec/runner";

const MAX_CODE = 64 * 1024;
const MAX_TESTS = 50;
const MAX_IO = 256 * 1024;

export interface RunEvent {
  language: Language;
  code: string;
  tests: TestCase[];
  cpuSec?: number;
}

export function validate(e: unknown): RunEvent {
  const ev = e as Partial<RunEvent> | null;
  if (!ev || typeof ev !== "object") throw new Error("Invalid payload");
  if (!LANGUAGES.includes(ev.language as Language)) throw new Error("Unsupported language");
  if (typeof ev.code !== "string" || ev.code.length > MAX_CODE) throw new Error("Code missing or larger than 64 KB");
  if (!Array.isArray(ev.tests) || ev.tests.length === 0 || ev.tests.length > MAX_TESTS) throw new Error("Between 1 and 50 tests are required");
  for (const t of ev.tests) {
    if (typeof t?.input !== "string" || typeof t?.output !== "string" || t.input.length > MAX_IO || t.output.length > MAX_IO) throw new Error("Invalid test case");
  }
  const cpuSec = Math.min(5, Math.max(1, Number(ev.cpuSec ?? 3) || 3));
  return { language: ev.language as Language, code: ev.code, tests: ev.tests, cpuSec };
}

function parentOf(pid: number): number {
  try {
    return Number(/^PPid:\s+(\d+)/m.exec(readFileSync(`/proc/${pid}/status`, "utf8"))?.[1] ?? 0);
  } catch {
    return 0;
  }
}

/**
 * A Lambda execution environment serves one invocation at a time and is reused for later ones, so after each run we
 * kill every process that isn't this runtime or one of its ancestors (e.g. a daemon a candidate's program detached),
 * and empty /tmp, so nothing from one candidate's run can observe or affect the next.
 */
export function reapStrays() {
  const keep = new Set<number>();
  for (let p = process.pid; p > 0 && !keep.has(p); p = parentOf(p)) keep.add(p);
  for (const name of readdirSync("/proc")) {
    const pid = Number(name);
    if (!Number.isInteger(pid) || pid <= 1 || keep.has(pid)) continue;
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* gone, or not ours to kill */
    }
  }
  for (const entry of readdirSync("/tmp")) rmSync(`/tmp/${entry}`, { recursive: true, force: true });
}

export async function handler(event: unknown): Promise<{ results: TestResult[] }> {
  const ev = validate(event);
  try {
    return { results: await runTests(ev.language, ev.code, ev.tests, ev.cpuSec) };
  } finally {
    if (process.env.AWS_LAMBDA_FUNCTION_NAME) reapStrays();
  }
}
