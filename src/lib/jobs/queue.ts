import { sql } from "drizzle-orm";
import { db } from "../db";

export type JobType =
  | "parse-resume"
  | "analyze-repo"
  | "evaluate-round"
  | "combined-report"
  | "send-email";

/**
 * Enqueue a durable job. With a singleton key, a job that is already queued/running is not duplicated,
 * while a finished one is re-queued.
 */
export async function enqueue(type: JobType, payload: Record<string, unknown>, opts: { singletonKey?: string; delaySec?: number; maxAttempts?: number } = {}) {
  const runAt = new Date(Date.now() + (opts.delaySec ?? 0) * 1000);
  await db.execute(sql`
    insert into jobs (type, payload, run_at, max_attempts, singleton_key)
    values (${type}, ${JSON.stringify(payload)}::jsonb, ${runAt.toISOString()}::timestamptz, ${opts.maxAttempts ?? 3}, ${opts.singletonKey ?? null})
    on conflict (singleton_key) do update
      set status = 'queued', attempts = 0, payload = excluded.payload, run_at = excluded.run_at, last_error = null, updated_at = now()
      where jobs.status in ('done', 'failed')
  `);
}
