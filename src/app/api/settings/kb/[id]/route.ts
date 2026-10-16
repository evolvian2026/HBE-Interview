import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { HttpError, requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";

export const DELETE = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("admin");
  const { id } = await params;
  const gone = await db.delete(schema.kbDocuments).where(and(eq(schema.kbDocuments.id, id), eq(schema.kbDocuments.orgId, user.orgId))).returning({ id: schema.kbDocuments.id });
  if (!gone.length) throw new HttpError(404, "Document not found");
  return json({ ok: true });
});
