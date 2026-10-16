import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { requireCandidateSession } from "@/lib/auth/candidate-session";
import { HttpError } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { currentSection, type SessionState } from "@/lib/core/interview";

const Body = z.object({ content: z.record(z.string(), z.string().max(8000)) });

/** Autosave the written exercise (system design / case). Submission happens via a "submitted" turn. */
export const PUT = handle(async (req: Request, { params }: { params: Promise<{ token: string; sid: string }> }) => {
  const { token, sid } = await params;
  const { session } = await requireCandidateSession(token, sid);
  if (session.status !== "active") throw new HttpError(409, "This round has ended");
  const state = session.state as SessionState;
  const sec = currentSection(state);
  const ex = sec ? state.exercises[sec.key] : undefined;
  if (!ex || !["system_design", "domain_case", "mgmt_case", "prioritization"].includes(ex.kind)) throw new HttpError(409, "No written exercise is open right now");
  if (ex.submittedAt) throw new HttpError(409, "Already submitted");
  const { content } = Body.parse(await req.json());
  await db
    .update(schema.exerciseResponses)
    .set({ content, updatedAt: new Date() })
    .where(and(eq(schema.exerciseResponses.sessionId, sid), eq(schema.exerciseResponses.kind, ex.kind)));
  return json({ ok: true });
});
