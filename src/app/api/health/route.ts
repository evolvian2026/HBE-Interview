import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { lastWorkerHeartbeat, queueStats } from "@/lib/services/ops";

export const dynamic = "force-dynamic";

/**
 * Liveness/readiness for the load balancer and uptime monitors. 503 when the database is unreachable; `worker` and
 * `queue` let monitors alert when background jobs stall (e.g. worker age > 120 s or oldest due job > 300 s).
 */
export async function GET() {
  try {
    await db.execute(sql`select 1`);
  } catch {
    return Response.json({ ok: false, db: "down" }, { status: 503 });
  }
  const [hb, q] = await Promise.all([lastWorkerHeartbeat().catch(() => null), queueStats().catch(() => null)]);
  return Response.json({
    ok: true,
    db: "up",
    aiMock: env.aiMock,
    executor: env.codeExecutor,
    worker: hb ? { lastSeenSecAgo: hb.ageSec, healthy: hb.ageSec < 120 } : { lastSeenSecAgo: null, healthy: false },
    queue: q ? { due: q.due, running: q.running, oldestDueSec: q.oldestDueSec ?? 0, failed24h: q.failed24h } : null,
  });
}
