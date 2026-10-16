import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";

export const DELETE = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  await requireStaff("admin");
  const { id } = await params;
  await db.delete(schema.kbDocuments).where(eq(schema.kbDocuments.id, id));
  return json({ ok: true });
});
