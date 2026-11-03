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

/** The voice plan for each of a drive's interview languages (passed to the interview room). */
export async function speechPlans(orgId: string, languages: string[]) {
  const out: Record<string, { natural: boolean; naturalInput: boolean; locale: string }> = {};
  for (const code of languages) {
    const p = await voicePlan(orgId, code);
    out[code] = { natural: p.natural, naturalInput: p.naturalInput, locale: p.locale };
  }
  return out;
}
