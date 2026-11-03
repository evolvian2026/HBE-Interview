import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { HttpError } from "@/lib/auth/staff";
import { requireCandidateSession } from "@/lib/auth/candidate-session";
import { handle } from "@/lib/http";
import { limit } from "@/lib/security/rate-limit";
import { speakableText } from "@/lib/core/speech";
import { recordSpeech, synthesize } from "@/lib/speech/service";
import { asHttp, voicePlan } from "@/lib/speech/policy";

const UUID = /^[0-9a-f-]{36}$/i;

/** The interviewer's message, spoken with the natural voice. Only the interviewer's own messages in this session. */
export const GET = handle(async (_req: Request, { params }: { params: Promise<{ token: string; sid: string; mid: string }> }) => {
  const { token, sid, mid } = await params;
  if (!UUID.test(sid) || !UUID.test(mid)) throw new HttpError(404, "Not found");
  const { session, candidacy } = await requireCandidateSession(token, sid);
  const [m] = await db
    .select({ content: schema.messages.content })
    .from(schema.messages)
    .where(and(eq(schema.messages.id, mid), eq(schema.messages.sessionId, session.id), eq(schema.messages.role, "ai")));
  if (!m) throw new HttpError(404, "Not found");
  const plan = await voicePlan(candidacy.orgId, session.language);
  if (!plan.natural) throw new HttpError(503, "Natural voice isn't available — the browser's voice is used instead.");
  const text = speakableText(m.content);
  if (!text) return new Response(null, { status: 204 });
  await limit(`tts:${session.id}`, 400, 3600, "Too many replays — please read the message on screen.");
  const audio = await synthesize(text, plan.locale, plan.gender).catch(asHttp);
  void recordSpeech(candidacy.orgId, "tts", text.length);
  return new Response(audio.body, { headers: { "content-type": audio.type, "cache-control": "private, max-age=900", "x-content-type-options": "nosniff" } });
});
