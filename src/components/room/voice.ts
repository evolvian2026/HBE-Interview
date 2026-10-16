"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* Browser Web Speech API — speech-to-text (Chrome/Edge/Safari) and text-to-speech (all modern browsers). */

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function voiceSupport() {
  return { stt: !!recognitionCtor(), tts: typeof window !== "undefined" && "speechSynthesis" in window };
}

/** Dictation hook: appends final transcripts via onFinal; exposes interim text while speaking. */
export function useDictation(onFinal: (text: string) => void, lang = "en-IN") {
  const recRef = useRef<Recognition | null>(null);
  const wantRef = useRef(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setError("Voice input isn't supported in this browser. Please use Chrome or Edge, or type your answers.");
      return;
    }
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang;
    rec.onresult = (e) => {
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) onFinal(r[0].transcript.trim());
        else interimText += r[0].transcript;
      }
      setInterim(interimText);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed") {
        setError("Microphone access was blocked. Allow it in your browser, or type your answers.");
        wantRef.current = false;
      }
    };
    rec.onend = () => {
      setInterim("");
      if (wantRef.current) {
        try {
          rec.start();
        } catch {
          setListening(false);
        }
      } else setListening(false);
    };
    recRef.current = rec;
    wantRef.current = true;
    setError("");
    try {
      rec.start();
      setListening(true);
    } catch {
      /* already started */
    }
  }, [onFinal, lang]);

  const stop = useCallback(() => {
    wantRef.current = false;
    recRef.current?.stop();
    setListening(false);
  }, []);

  useEffect(() => () => {
    wantRef.current = false;
    recRef.current?.stop();
  }, []);

  return { listening, interim, error, start, stop };
}

export function speak(text: string, lang = "en-IN", onEnd?: () => void) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const clean = text.replace(/```[\s\S]*?```/g, " (see the code on screen) ").replace(/[`*_#]/g, "");
  const u = new SpeechSynthesisUtterance(clean);
  u.rate = 1;
  const voices = window.speechSynthesis.getVoices();
  const base = lang.split("-")[0];
  u.lang = lang;
  const v =
    voices.find((x) => x.lang === lang && /female|google|natural/i.test(x.name)) ??
    voices.find((x) => x.lang === lang) ??
    voices.find((x) => x.lang.startsWith(base)) ??
    (base === "en" ? voices.find((x) => x.lang.startsWith("en")) : undefined);
  if (v) u.voice = v;
  if (onEnd) u.onend = onEnd;
  window.speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}
