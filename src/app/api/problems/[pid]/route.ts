import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { HttpError, requireDriveAccess, requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";

/** Delete a drive's custom coding problem (bank problems can't be deleted). */
export const DELETE = handle(async (_req: Request, { params }: { params: Promise<{ pid: string }> }) => {
  const user = await requireStaff("recruiter");
  const { pid } = await params;
  const [p] = await db.select({ driveId: schema.codingProblems.driveId }).from(schema.codingProblems).where(eq(schema.codingProblems.id, pid));
  if (!p?.driveId) throw new HttpError(404, "Problem not found");
  await requireDriveAccess(user, p.driveId);
  await db.delete(schema.codingProblems).where(eq(schema.codingProblems.id, pid));
  return json({ ok: true });
});
