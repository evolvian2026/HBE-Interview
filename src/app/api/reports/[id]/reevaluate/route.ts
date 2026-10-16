import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { HttpError, assertCandidacyAccess, requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { enqueue } from "@/lib/jobs/queue";

export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("recruiter");
  const { id } = await params;
  const [r] = await db.select().from(schema.roundReports).where(eq(schema.roundReports.id, id));
  if (!r) throw new HttpError(404, "Report not found");
  await assertCandidacyAccess(user, r.candidacyId);
  await db.update(schema.roundReports).set({ status: "pending", error: null, updatedAt: new Date() }).where(eq(schema.roundReports.id, id));
  await enqueue("evaluate-round", { sessionId: r.sessionId }, { singletonKey: `evaluate:${r.sessionId}`, maxAttempts: 5 });
  return json({ ok: true });
});
