import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { HttpError } from "../auth/staff";

const HEARTBEAT_KEY = "worker:heartbeat";

/** Record that a job worker is alive (called every 30 s by each worker process). */
export async function workerHeartbeat(info: { concurrency: number }) {
  const value = { at: new Date().toISOString(), pid: process.pid, concurrency: info.concurrency };
  await db
    .insert(schema.settings)
    .values({ key: HEARTBEAT_KEY, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: new Date() } });
}

export async function lastWorkerHeartbeat(): Promise<{ at: string; ageSec: number } | null> {
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, HEARTBEAT_KEY));
  const at = (row?.value as { at?: string } | undefined)?.at;
  return at ? { at, ageSec: Math.round((Date.now() - new Date(at).getTime()) / 1000) } : null;
}

export async function queueStats() {
  const [s] = await db
    .select({
      queued: sql<number>`count(*) filter (where ${schema.jobs.status} = 'queued')::int`,
      due: sql<number>`count(*) filter (where ${schema.jobs.status} = 'queued' and ${schema.jobs.runAt} <= now())::int`,
      running: sql<number>`count(*) filter (where ${schema.jobs.status} = 'running')::int`,
      failed24h: sql<number>`count(*) filter (where ${schema.jobs.status} = 'failed' and ${schema.jobs.updatedAt} > now() - interval '24 hours')::int`,
      retrying: sql<number>`count(*) filter (where ${schema.jobs.status} = 'queued' and ${schema.jobs.attempts} > 0)::int`,
      oldestDueSec: sql<number | null>`extract(epoch from now() - min(${schema.jobs.runAt}) filter (where ${schema.jobs.status} = 'queued' and ${schema.jobs.runAt} <= now()))::int`,
    })
    .from(schema.jobs);
  const byType = await db
    .select({ type: schema.jobs.type, status: schema.jobs.status, n: sql<number>`count(*)::int` })
    .from(schema.jobs)
    .where(sql`${schema.jobs.updatedAt} > now() - interval '7 days' or ${schema.jobs.status} in ('queued','running')`)
    .groupBy(schema.jobs.type, schema.jobs.status);
  return { ...s, byType };
}

export async function failedJobs(limit = 50) {
  return db.select().from(schema.jobs).where(eq(schema.jobs.status, "failed")).orderBy(desc(schema.jobs.updatedAt)).limit(limit);
}

export async function retryJob(id: number) {
  const [j] = await db
    .update(schema.jobs)
    .set({ status: "queued", attempts: 0, runAt: new Date(), lockedAt: null, updatedAt: new Date() })
    .where(and(eq(schema.jobs.id, id), eq(schema.jobs.status, "failed")))
    .returning({ id: schema.jobs.id });
  if (!j) throw new HttpError(404, "Failed job not found");
}

export async function discardJob(id: number) {
  const gone = await db.delete(schema.jobs).where(and(eq(schema.jobs.id, id), eq(schema.jobs.status, "failed"))).returning({ id: schema.jobs.id });
  if (!gone.length) throw new HttpError(404, "Failed job not found");
}

/** Keep the queue table small: completed jobs for 7 days, failed ones for 30. */
export async function pruneJobs() {
  await db.execute(sql`delete from jobs where (status = 'done' and updated_at < now() - interval '7 days') or (status = 'failed' and updated_at < now() - interval '30 days')`);
  await db.execute(sql`delete from rate_limits where window_start < now() - interval '1 day'`);
}
