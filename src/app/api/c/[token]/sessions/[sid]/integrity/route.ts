import { z } from "zod";
import { db, schema } from "@/lib/db";
import { requireCandidateSession } from "@/lib/auth/candidate-session";
import { handle, json } from "@/lib/http";

const Body = z.object({
  events: z
    .array(z.object({ type: z.enum(["blur", "paste", "copy", "fullscreen_exit", "fast_answer", "devtools", "camera_off"]), payload: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional() }))
    .max(50),
});

/** Batched browser integrity signals — context for reviewers, never part of the score. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ token: string; sid: string }> }) => {
  const { token, sid } = await params;
  const { session } = await requireCandidateSession(token, sid);
  if (session.status !== "active") return json({ ok: true });
  const { events } = Body.parse(await req.json());
  if (events.length) await db.insert(schema.integrityEvents).values(events.map((e) => ({ sessionId: sid, type: e.type, payload: e.payload ?? null })));
  return json({ ok: true });
});
