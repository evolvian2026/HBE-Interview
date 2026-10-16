import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { HttpError, assertCandidacyAccess, requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { overrideScore } from "@/lib/services/evaluation";

const Body = z.object({ parameter: z.string(), score: z.number().int().min(1).max(5), reason: z.string().trim().min(20, "Please give a reason of at least 20 characters").max(2000) });

export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("hiring_manager");
  const { id } = await params;
  const [rep] = await db.select({ candidacyId: schema.roundReports.candidacyId }).from(schema.roundReports).where(eq(schema.roundReports.id, id));
  if (!rep) throw new HttpError(404, "Report not found");
  await assertCandidacyAccess(user, rep.candidacyId);
  const { parameter, score, reason } = Body.parse(await req.json());
  try {
    await overrideScore(id, parameter, score, reason, user);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  return json({ ok: true });
});
