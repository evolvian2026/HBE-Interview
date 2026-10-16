import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { HttpError, assertCandidacyAccess, requireStaff } from "@/lib/auth/staff";
import { handle } from "@/lib/http";

/** Staff-only access to a proctoring snapshot. */
export const GET = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("viewer");
  const { id } = await params;
  const [row] = await db
    .select({ snap: schema.proctorSnapshots, candidacyId: schema.roundSessions.candidacyId })
    .from(schema.proctorSnapshots)
    .innerJoin(schema.roundSessions, eq(schema.proctorSnapshots.sessionId, schema.roundSessions.id))
    .where(eq(schema.proctorSnapshots.id, id));
  if (!row) throw new HttpError(404, "Not found");
  await assertCandidacyAccess(user, row.candidacyId);
  return new Response(new Uint8Array(row.snap.image), { headers: { "content-type": row.snap.mimeType, "cache-control": "private, max-age=300" } });
});
