/**
 * Cloud speech for natural voice: text-to-speech for the interviewer and speech-to-text for spoken answers.
 * Provider: Azure AI Speech (REST, no SDK). A mock provider (SPEECH_MOCK=true) is used for development and tests.
 * Audio is never stored by HBE Interview: answers are sent for transcription and only the text is kept.
 */
import { db, schema } from "../db";
import { STT_LOCALES, VOICES, ssml, type VoiceGender } from "../core/speech";

export class SpeechError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface SpeechConfig {
  provider: "azure" | "mock" | null;
  region: string;
  key: string;
  apiVersion: string;
  voices: Record<string, [string, string]>;
  sttLocales: string[];
  /** Estimates for the usage page (USD); set to match your Azure price sheet. */
  pricePerMillionChars: number;
  pricePerAudioHour: number;
}

function jsonEnv<T>(name: string, fallback: T): T {
  try {
    return process.env[name] ? (JSON.parse(process.env[name]!) as T) : fallback;
  } catch {
    console.error(`${name} is not valid JSON; ignoring it`);
    return fallback;
  }
}

export function speechConfig(): SpeechConfig {
  const key = process.env.AZURE_SPEECH_KEY ?? "";
  const region = process.env.AZURE_SPEECH_REGION ?? "";
  const mock = process.env.SPEECH_MOCK === "true";
  return {
    provider: mock ? "mock" : key && region ? "azure" : null,
    region,
    key,
    apiVersion: process.env.AZURE_SPEECH_API_VERSION || "2024-11-15",
    voices: { ...VOICES, ...jsonEnv<Record<string, [string, string]>>("AZURE_SPEECH_VOICES", {}) },
    sttLocales: [...STT_LOCALES, ...(process.env.AZURE_STT_LOCALES ?? "").split(",").map((s) => s.trim()).filter(Boolean)],
    pricePerMillionChars: Number(process.env.SPEECH_PRICE_PER_MILLION_CHARS ?? 16) || 0,
    pricePerAudioHour: Number(process.env.SPEECH_PRICE_PER_AUDIO_HOUR ?? 1) || 0,
  };
}

export const speechAvailable = () => speechConfig().provider !== null;

/* ------------------------------ Text to speech ----------------------------- */

/** Synthesise speech; returns a streaming audio body. */
export async function synthesize(text: string, locale: string, gender: VoiceGender): Promise<{ body: ReadableStream<Uint8Array>; type: string }> {
  const cfg = speechConfig();
  const pair = cfg.voices[locale];
  if (!cfg.provider || !pair) throw new SpeechError(503, "Natural voice isn't available for this language.");
  const voice = gender === "male" ? pair[1] : pair[0];
  if (cfg.provider === "mock") {
    const wav = mockWav(Math.min(4, 0.4 + text.length * 0.02));
    return { body: new Blob([new Uint8Array(wav)]).stream(), type: "audio/wav" };
  }
  const res = await fetch(`https://${cfg.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": cfg.key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      "User-Agent": "hbe-interview",
    },
    body: ssml(text, voice, locale),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok || !res.body) throw new SpeechError(502, `The speech service returned ${res.status}.`);
  return { body: res.body, type: "audio/mpeg" };
}

/* ------------------------------ Speech to text ----------------------------- */

export function sttSupported(locale: string) {
  const cfg = speechConfig();
  return !!cfg.provider && cfg.sttLocales.includes(locale);
}

/** Transcribe one spoken answer (fast transcription: synchronous, audio not retained by HBE Interview). */
export async function transcribe(audio: Blob, locale: string): Promise<{ text: string; durationMs: number }> {
  const cfg = speechConfig();
  if (!cfg.provider || !cfg.sttLocales.includes(locale)) throw new SpeechError(503, "Speech-to-text isn't available for this language.");
  if (cfg.provider === "mock") {
    return { text: "This is a mock transcript of a spoken answer. I explained my approach step by step, the trade-offs I considered, and how I tested it.", durationMs: Math.max(1000, Math.round(audio.size / 4)) };
  }
  const form = new FormData();
  const ext = audio.type.includes("mp4") ? "m4a" : audio.type.includes("ogg") ? "ogg" : audio.type.includes("wav") ? "wav" : "webm";
  form.append("audio", audio, `answer.${ext}`);
  form.append("definition", JSON.stringify({ locales: [locale], profanityFilterMode: "None" }));
  const res = await fetch(`https://${cfg.region}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=${encodeURIComponent(cfg.apiVersion)}`, {
    method: "POST",
    headers: { "Ocp-Apim-Subscription-Key": cfg.key },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new SpeechError(502, `The speech service returned ${res.status}.`);
  const data = (await res.json()) as { durationMilliseconds?: number; combinedPhrases?: { text?: string }[] };
  const text = (data.combinedPhrases ?? []).map((p) => p.text ?? "").join(" ").trim();
  return { text, durationMs: data.durationMilliseconds ?? 0 };
}

/* ---------------------------------- Usage ---------------------------------- */

export async function recordSpeech(orgId: string, kind: "tts" | "stt", units: number, error?: string) {
  await db
    .insert(schema.speechUsage)
    .values({ orgId, kind, units: Math.round(units), provider: speechConfig().provider ?? "none", error: error ?? null })
    .catch((e) => console.error("failed to record speech usage", e));
}

export function speechCost(kind: "tts" | "stt", units: number) {
  const cfg = speechConfig();
  return kind === "tts" ? (units / 1_000_000) * cfg.pricePerMillionChars : (units / 3_600_000) * cfg.pricePerAudioHour;
}

/* ----------------------------------- Mock ----------------------------------- */

/** A short, quiet two-tone WAV (16 kHz mono) so audio playback can be tested without a speech service. */
function mockWav(seconds: number): Buffer {
  const rate = 16000;
  const n = Math.round(rate * seconds);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const f = i < n / 2 ? 330 : 440;
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * f * i) / rate) * 1500), 44 + i * 2);
  }
  return buf;
}
