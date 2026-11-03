import { z } from "zod";
import { HttpError, requireStaff } from "@/lib/auth/staff";
import { handle } from "@/lib/http";
import { limit } from "@/lib/security/rate-limit";
import { getSettings } from "@/lib/settings";
import { recordSpeech, speechAvailable, synthesize } from "@/lib/speech/service";
import { asHttp } from "@/lib/speech/policy";

const Body = z.object({ accent: z.enum(["en-IN", "en-US", "en-GB"]), gender: z.enum(["female", "male"]) });

/** Admins hear the interviewer voice before choosing it. */
export const POST = handle(async (req: Request) => {
  const user = await requireStaff("admin");
  const b = Body.parse(await req.json());
  if (!speechAvailable()) throw new HttpError(503, "Natural voice isn't configured on this server (AZURE_SPEECH_KEY and AZURE_SPEECH_REGION).");
  await limit(`voice-preview:${user.orgId}`, 60, 3600);
  const { companyName } = await getSettings(user.orgId);
  const text = `Hello, I'm your AI interviewer at ${companyName}. Take your time — and if a question isn't clear, just ask me to rephrase it.`;
  const audio = await synthesize(text, b.accent, b.gender).catch(asHttp);
  void recordSpeech(user.orgId, "tts", text.length);
  return new Response(audio.body, { headers: { "content-type": audio.type, "cache-control": "no-store" } });
});
