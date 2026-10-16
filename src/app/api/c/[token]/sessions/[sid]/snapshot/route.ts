import { z } from "zod";
import { db, schema } from "@/lib/db";
import { requireCandidateSession } from "@/lib/auth/candidate-session";
import { HttpError } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { enqueue } from "@/lib/jobs/queue";
import type { DriveConfig } from "@/lib/core/types";
import { eq } from "drizzle-orm";

const Body = z.object({ image: z.string().startsWith("data:image/jpeg;base64,").max(200_000) });
const last = new Map<string, number>();

/** Store an opt-in webcam snapshot and queue the presence check. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ token: string; sid: string }> }) => {
  const { token, sid } = await params;
  const { session, candidacy } = await requireCandidateSession(token, sid);
  if (session.status !== "active") return json({ ok: true });
  const [v] = await db.select().from(schema.driveVersions).where(eq(schema.driveVersions.id, candidacy.driveVersionId));
  const cfg = v.config as DriveConfig;
  if (!cfg.proctoring?.webcam || !(candidacy.consent as { webcam?: boolean } | null)?.webcam) throw new HttpError(403, "Webcam proctoring is not enabled for this interview");
  const minGap = Math.max(20, (cfg.proctoring.intervalSec ?? 90) - 10) * 1000;
  if (Date.now() - (last.get(sid) ?? 0) < minGap) return json({ ok: true, skipped: true });
  last.set(sid, Date.now());
  const { image } = Body.parse(await req.json());
  const bytes = Buffer.from(image.slice("data:image/jpeg;base64,".length), "base64");
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) throw new HttpError(400, "Invalid image");
  const [snap] = await db.insert(schema.proctorSnapshots).values({ sessionId: sid, image: bytes, mimeType: "image/jpeg" }).returning({ id: schema.proctorSnapshots.id });
  await enqueue("proctor-check", { snapshotId: snap.id }, { singletonKey: `proctor:${snap.id}` });
  return json({ ok: true });
});
