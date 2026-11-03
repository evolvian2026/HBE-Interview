import { getSettings } from "../settings";
import { languageInfo } from "../core/languages";
import { DEFAULT_VOICE, speechLocale, type VoiceSettings } from "../core/speech";
import { HttpError } from "../auth/staff";
import { SpeechError, speechConfig, sttSupported } from "./service";

/** How the interviewer speaks and listens for one organisation and interview language. */
export async function voicePlan(orgId: string, languageCode: string | null | undefined) {
  const settings = await getSettings(orgId);
  const voice: VoiceSettings = { ...DEFAULT_VOICE, ...(settings.voice ?? {}) };
  const locale = speechLocale(languageInfo(languageCode).speech, voice.accent);
  const cfg = speechConfig();
  const natural = voice.engine === "natural" && !!cfg.provider && !!cfg.voices[locale];
  return { natural, naturalInput: natural && sttSupported(locale), locale, gender: voice.gender, voice };
}

export function asHttp(e: unknown): never {
  if (e instanceof SpeechError) throw new HttpError(e.status, e.message);
  throw e;
}
