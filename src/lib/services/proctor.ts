import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { checkPresence, presenceFlagged } from "../ai/proctor";

export async function proctorCheckJob(payload: { snapshotId: string }) {
  const [row] = await db
    .select({ snap: schema.proctorSnapshots, candidacyId: schema.roundSessions.candidacyId })
    .from(schema.proctorSnapshots)
    .innerJoin(schema.roundSessions, eq(schema.proctorSnapshots.sessionId, schema.roundSessions.id))
    .where(eq(schema.proctorSnapshots.id, payload.snapshotId));
  if (!row || row.snap.check) return;
  const check = await checkPresence(row.snap.image, { sessionId: row.snap.sessionId, candidacyId: row.candidacyId });
  await db.update(schema.proctorSnapshots).set({ check, flagged: presenceFlagged(check) }).where(eq(schema.proctorSnapshots.id, payload.snapshotId));
}
