import { HttpError } from "@/lib/auth/staff";
import { requireCandidateSession } from "@/lib/auth/candidate-session";
import { handle, json } from "@/lib/http";
import { limit } from "@/lib/security/rate-limit";
import { MAX_UPLOAD_BYTES, acceptableAudio } from "@/lib/core/speech";
import { recordSpeech, transcribe } from "@/lib/speech/service";
import { asHttp, voicePlan } from "@/lib/speech/policy";

const UUID = /^[0-9a-f-]{36}$/i;

/** A spoken answer → text. The audio is passed to the speech service and not kept; the candidate edits the text before sending. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ token: string; sid: string }> }) => {
  const { token, sid } = await params;
  if (!UUID.test(sid)) throw new HttpError(404, "Not found");
  const { session, candidacy } = await requireCandidateSession(token, sid);
  if (session.status !== "active") throw new HttpError(409, "This round has ended.");
  const type = req.headers.get("content-type") ?? "";
  if (!acceptableAudio(type)) throw new HttpError(415, "Unsupported audio format.");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES) throw new HttpError(413, "That recording is too long — please answer in shorter parts.");
  const buf = await req.arrayBuffer();
  if (buf.byteLength > MAX_UPLOAD_BYTES) throw new HttpError(413, "That recording is too long — please answer in shorter parts.");
  if (buf.byteLength < 200) throw new HttpError(400, "No audio was received.");
  const plan = await voicePlan(candidacy.orgId, session.language);
  if (!plan.naturalInput) throw new HttpError(503, "Speech-to-text isn't available for this interview — please use your browser's dictation or type.");
  await limit(`stt:${session.id}`, 150, 3600, "Too many recordings in a short time — please type your answer.");
  const out = await transcribe(new Blob([buf], { type: type.split(";")[0] }), plan.locale).catch(asHttp);
  void recordSpeech(candidacy.orgId, "stt", out.durationMs);
  return json({ text: out.text });
});
