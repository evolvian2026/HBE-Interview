/**
 * Natural voice (pure): which locale and voice to use for an interview language, what the interviewer's text sounds
 * like when read aloud, and safe SSML for the speech service.
 */

export type VoiceGender = "female" | "male";
export type EnglishAccent = "en-IN" | "en-US" | "en-GB";

export interface VoiceSettings {
  /** "natural" uses the cloud speech service when it is configured; "browser" always uses the browser's own speech. */
  engine: "natural" | "browser";
  /** Which English the interviewer speaks and listens for. */
  accent: EnglishAccent;
  gender: VoiceGender;
}

export const DEFAULT_VOICE: VoiceSettings = { engine: "natural", accent: "en-IN", gender: "female" };

/** Azure neural voices per locale: [female, male]. Overridable per deployment (AZURE_SPEECH_VOICES). */
export const VOICES: Record<string, [string, string]> = {
  "en-IN": ["en-IN-NeerjaNeural", "en-IN-PrabhatNeural"],
  "en-US": ["en-US-JennyNeural", "en-US-GuyNeural"],
  "en-GB": ["en-GB-SoniaNeural", "en-GB-RyanNeural"],
  "hi-IN": ["hi-IN-SwaraNeural", "hi-IN-MadhurNeural"],
  "ta-IN": ["ta-IN-PallaviNeural", "ta-IN-ValluvarNeural"],
  "te-IN": ["te-IN-ShrutiNeural", "te-IN-MohanNeural"],
  "bn-IN": ["bn-IN-TanishaaNeural", "bn-IN-BashkarNeural"],
  "mr-IN": ["mr-IN-AarohiNeural", "mr-IN-ManoharNeural"],
  "es-ES": ["es-ES-ElviraNeural", "es-ES-AlvaroNeural"],
  "fr-FR": ["fr-FR-DeniseNeural", "fr-FR-HenriNeural"],
  "de-DE": ["de-DE-KatjaNeural", "de-DE-ConradNeural"],
  "pt-BR": ["pt-BR-FranciscaNeural", "pt-BR-AntonioNeural"],
  "ar-SA": ["ar-SA-ZariyahNeural", "ar-SA-HamedNeural"],
  "ja-JP": ["ja-JP-NanamiNeural", "ja-JP-KeitaNeural"],
};

/**
 * Locales the cloud speech-to-text (fast transcription) is known to handle. Others fall back to the browser's own
 * recognition for answers, while the interviewer still speaks with the natural voice. Extendable (AZURE_STT_LOCALES).
 */
export const STT_LOCALES = ["en-IN", "en-US", "en-GB", "hi-IN", "es-ES", "fr-FR", "de-DE", "pt-BR", "ja-JP"];

/** BCP-47 locale for an interview language (English follows the organisation's accent setting). */
export function speechLocale(languageSpeechTag: string, accent: EnglishAccent): string {
  return languageSpeechTag.startsWith("en") ? accent : languageSpeechTag;
}

export function voiceFor(locale: string, gender: VoiceGender, overrides: Record<string, [string, string]> = {}): string | null {
  const pair = overrides[locale] ?? VOICES[locale];
  if (!pair) return null;
  return gender === "male" ? pair[1] : pair[0];
}

/** Maximum characters read aloud per message (keeps the request inside the service's limits). */
export const MAX_SPOKEN_CHARS = 3000;

/** What the interviewer's message sounds like: no markdown, code replaced by a pointer to the screen. */
export function speakableText(markdown: string): string {
  const out = markdown
    .replace(/```[\s\S]*?```/g, " (see the code on screen) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/(\*\*|__|\*|_|~~)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
  if (out.length <= MAX_SPOKEN_CHARS) return out;
  const cut = out.slice(0, MAX_SPOKEN_CHARS);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return `${end > MAX_SPOKEN_CHARS / 2 ? cut.slice(0, end + 1) : cut} The rest is on screen.`;
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** SSML for one message. Text is escaped, so nothing in a message can inject SSML. */
export function ssml(text: string, voice: string, locale: string, ratePct = 0): string {
  const body = xml(text);
  const inner = ratePct ? `<prosody rate="${ratePct > 0 ? "+" : ""}${Math.round(ratePct)}%">${body}</prosody>` : body;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${xml(locale)}"><voice name="${xml(voice)}">${inner}</voice></speak>`;
}

/** Audio formats browsers record in, in order of preference; the speech service accepts all of them. */
export const RECORDING_TYPES = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"];
/** Longest single spoken answer and largest upload accepted. */
export const MAX_ANSWER_SEC = 300;
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

export function acceptableAudio(mime: string): boolean {
  const base = mime.split(";")[0].trim().toLowerCase();
  return ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/aac", "video/webm"].includes(base);
}
