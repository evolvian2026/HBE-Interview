import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { HttpError, requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { audit } from "@/lib/audit";

const Body = z.object({ roundIndex: z.number().int().min(0), reason: z.string().trim().min(5).max(1000) });

/** Grant a retake of a round (e.g. after a technical failure). Removes that round's session and report. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("recruiter");
  const { id } = await params;
  const { roundIndex, reason } = Body.parse(await req.json());
  const [c] = await db.select().from(schema.candidacies).where(eq(schema.candidacies.id, id));
  if (!c) throw new HttpError(404, "Not found");
  if (roundIndex !== c.currentRoundIndex) throw new HttpError(400, "Only the current round can be retaken");
  await db.delete(schema.roundSessions).where(and(eq(schema.roundSessions.candidacyId, id), eq(schema.roundSessions.roundIndex, roundIndex)));
  await db
    .update(schema.candidacies)
    .set({ stage: "round_available", roundAvailableUntil: new Date(Date.now() + 7 * 86_400_000), updatedAt: new Date() })
    .where(eq(schema.candidacies.id, id));
  await audit({ type: "staff", id: user.id }, "round.retake", "candidacy", id, { roundIndex, reason });
  return json({ ok: true });
});
