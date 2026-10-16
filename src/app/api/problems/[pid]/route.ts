import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";

export const DELETE = handle(async (_req: Request, { params }: { params: Promise<{ pid: string }> }) => {
  await requireStaff("recruiter");
  const { pid } = await params;
  await db.delete(schema.codingProblems).where(eq(schema.codingProblems.id, pid));
  return json({ ok: true });
});
