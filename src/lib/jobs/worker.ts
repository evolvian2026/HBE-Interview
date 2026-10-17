import { sql } from "drizzle-orm";
import { db } from "../db";
import { handlers } from "./handlers";
import { periodicMaintenance } from "../services/maintenance";
import { workerHeartbeat } from "../services/ops";

interface JobRow {
  id: number;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __hbeWorkerStarted: boolean | undefined;
}

async function pick(): Promise<JobRow | null> {
  const res = await db.execute(sql`
    update jobs set status = 'running', locked_at = now(), attempts = attempts + 1, updated_at = now()
    where id = (
      select id from jobs where status = 'queued' and run_at <= now()
      order by run_at, id for update skip locked limit 1
    )
    returning id, type, payload, attempts, max_attempts
  `);
  return (res.rows[0] as unknown as JobRow) ?? null;
}

async function runOne(): Promise<boolean> {
  const job = await pick();
  if (!job) return false;
  const handler = handlers[job.type];
  try {
    if (!handler) throw new Error(`No handler for job type ${job.type}`);
    await handler(job.payload);
    await db.execute(sql`update jobs set status = 'done', updated_at = now() where id = ${job.id}`);
  } catch (e) {
    const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ""}`.slice(0, 4000) : String(e);
    console.error(`[worker] job ${job.id} (${job.type}) failed (attempt ${job.attempts}/${job.max_attempts}):`, e);
    const final = job.attempts >= job.max_attempts;
    const backoffSec = Math.min(300, 5 * 2 ** job.attempts);
    await db.execute(sql`
      update jobs set status = ${final ? "failed" : "queued"}, last_error = ${msg},
        run_at = now() + (${backoffSec} || ' seconds')::interval, updated_at = now()
      where id = ${job.id}
    `);
    if (final) {
      const onFail = handlers[`${job.type}:failed`];
      if (onFail) await onFail({ ...job.payload, error: msg }).catch((err) => console.error(err));
    }
  }
  return true;
}

async function recoverStale() {
  await db.execute(sql`
    update jobs set status = 'queued', locked_at = null, updated_at = now()
    where status = 'running' and locked_at < now() - interval '15 minutes'
  `);
}

export function startWorker(concurrency = Number(process.env.WORKER_CONCURRENCY ?? 3)) {
  if (globalThis.__hbeWorkerStarted) return;
  globalThis.__hbeWorkerStarted = true;
  console.log(`[worker] starting with concurrency ${concurrency}`);
  const beat = () => workerHeartbeat({ concurrency }).catch((e) => console.error("[worker] heartbeat failed", e));
  void beat();
  setInterval(beat, 30_000).unref?.();
  for (let i = 0; i < concurrency; i++) {
    (async function loop() {
      for (;;) {
        try {
          const worked = await runOne();
          if (!worked) await new Promise((r) => setTimeout(r, 1000));
        } catch (e) {
          console.error("[worker] loop error", e);
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    })();
  }
  setInterval(() => {
    recoverStale().catch((e) => console.error(e));
    periodicMaintenance().catch((e) => console.error("[maintenance]", e));
  }, 30_000);
}
