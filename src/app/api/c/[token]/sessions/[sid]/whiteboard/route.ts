import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { requireCandidateSession } from "@/lib/auth/candidate-session";
import { HttpError } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { currentSection, type SessionState } from "@/lib/core/interview";

const n = z.number().finite().min(-5000).max(5000);
const label = z.string().max(120).optional();
const Shape = z.discriminatedUnion("type", [
  z.object({ id: z.string().max(20), type: z.enum(["rect", "ellipse"]), x: n, y: n, w: n, h: n, label }),
  z.object({ id: z.string().max(20), type: z.literal("arrow"), x: n, y: n, x2: n, y2: n, label }),
  z.object({ id: z.string().max(20), type: z.literal("text"), x: n, y: n, text: z.string().max(200) }),
  z.object({ id: z.string().max(20), type: z.literal("pen"), points: z.array(z.tuple([n, n])).max(2000) }),
]);
const Body = z.object({ shapes: z.array(Shape).max(300), png: z.string().startsWith("data:image/png;base64,").max(2_000_000) });

/** Save the system-design whiteboard (vector shapes + rendered PNG). */
export const PUT = handle(async (req: Request, { params }: { params: Promise<{ token: string; sid: string }> }) => {
  const { token, sid } = await params;
  const { session } = await requireCandidateSession(token, sid);
  if (session.status !== "active") throw new HttpError(409, "This round has ended");
  const state = session.state as SessionState;
  const sec = currentSection(state);
  const ex = sec ? state.exercises[sec.key] : undefined;
  if (!ex || ex.kind !== "system_design") throw new HttpError(409, "The whiteboard is only available during system design");
  if (ex.submittedAt) throw new HttpError(409, "Already submitted");
  const { shapes, png } = Body.parse(await req.json());
  const bytes = Buffer.from(png.slice("data:image/png;base64,".length), "base64");
  if (bytes.subarray(1, 4).toString() !== "PNG") throw new HttpError(400, "Invalid image");
  await db
    .update(schema.exerciseResponses)
    .set({ whiteboard: shapes, whiteboardPng: bytes, updatedAt: new Date() })
    .where(and(eq(schema.exerciseResponses.sessionId, sid), eq(schema.exerciseResponses.kind, "system_design")));
  return json({ ok: true });
});
