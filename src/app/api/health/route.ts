import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, db: "up", aiMock: env.aiMock, executor: env.codeExecutor });
  } catch {
    return Response.json({ ok: false, db: "down" }, { status: 503 });
  }
}
