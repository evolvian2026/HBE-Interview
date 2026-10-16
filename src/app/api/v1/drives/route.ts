import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { requireApiKey } from "@/lib/services/integrations";

/** GET /api/v1/drives — list drives (scope drives:read). */
export const GET = handle(async (req: Request) => {
  const key = await requireApiKey(req, "drives:read");
  const rows = await db
    .select({ id: schema.drives.id, title: schema.drives.title, status: schema.drives.status, openSlug: schema.drives.openSlug, createdAt: schema.drives.createdAt })
    .from(schema.drives)
    .where(eq(schema.drives.orgId, key.orgId))
    .orderBy(desc(schema.drives.createdAt));
  return json({ data: rows });
});
