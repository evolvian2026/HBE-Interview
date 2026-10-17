import { sql } from "drizzle-orm";
import { db } from "../db";
import { HttpError } from "../auth/staff";

/**
 * Fixed-window counter in Postgres (shared by every app instance). Returns the count in the current window,
 * including this hit.
 */
export async function hit(key: string, windowSec: number): Promise<number> {
  const rows = await db.execute<{ count: number }>(sql`
    insert into rate_limits (key, count, window_start) values (${key}, 1, now())
    on conflict (key) do update set
      count = case when rate_limits.window_start < now() - make_interval(secs => ${windowSec}) then 1 else rate_limits.count + 1 end,
      window_start = case when rate_limits.window_start < now() - make_interval(secs => ${windowSec}) then now() else rate_limits.window_start end
    returning count`);
  return Number(rows.rows[0].count);
}

/** Throw 429 once `key` exceeds `limit` hits per `windowSec`. */
export async function limit(key: string, max: number, windowSec: number, message = "Too many attempts — please wait a few minutes and try again.") {
  if ((await hit(key, windowSec)) > max) throw new HttpError(429, message);
}

export async function resetLimit(key: string) {
  await db.execute(sql`delete from rate_limits where key = ${key}`);
}

export function clientIp(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}
