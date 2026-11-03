"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_ANSWER_SEC, MAX_UPLOAD_BYTES, RECORDING_TYPES } from "@/lib/core/speech";

/* Natural voice in the browser: record a spoken answer and send it for transcription; play the interviewer's voice. */

export function recordingSupported() {
  return typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

function pickType(): string {
  for (const t of RECORDING_TYPES) if (MediaRecorder.isTypeSupported?.(t)) return t;
  return "";
}

/**
 * Record → transcribe. While recording, `level` (0–1) drives a meter and `seconds` a timer; on stop the audio is
 * uploaded and the transcript is passed to onText (the candidate can still edit it before sending).
 */
export function useCloudDictation(transcribeUrl: string, onText: (text: string) => void) {
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const raf = useRef<number | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState("");

  const cleanup = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    if (raf.current) cancelAnimationFrame(raf.current);
    timer.current = null;
    raf.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtx.current?.close().catch(() => undefined);
    audioCtx.current = null;
    setLevel(0);
  }, []);

  const upload = useCallback(
    async (blob: Blob) => {
      if (blob.size < 800) {
        setError("We didn't catch any audio — please try again, closer to the microphone.");
        return;
      }
      if (blob.size > MAX_UPLOAD_BYTES) {
        setError("That answer is too long to send in one go — please answer in shorter parts.");
        return;
      }
      setTranscribing(true);
      try {
        const res = await fetch(transcribeUrl, { method: "POST", headers: { "content-type": blob.type || "audio/webm" }, body: blob });
        const data = (await res.json().catch(() => ({}))) as { text?: string; error?: { message?: string } };
        if (!res.ok) throw new Error(data.error?.message ?? "Transcription failed.");
        if (data.text?.trim()) onText(data.text.trim());
        else setError("We couldn't make out any words — please try again, or type your answer.");
      } catch (e) {
        setError(`${(e as Error).message} You can try again or type your answer.`);
      } finally {
        setTranscribing(false);
      }
    },
    [transcribeUrl, onText],
  );

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    setListening(false);
  }, []);

  const start = useCallback(async () => {
    setError("");
    if (!recordingSupported()) {
      setError("Recording isn't supported in this browser. Please type your answers.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      const type = pickType();
      const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.onstop = () => {
        const blob = new Blob(chunks.current, { type: rec.mimeType || type || "audio/webm" });
        cleanup();
        void upload(blob);
      };
      recRef.current = rec;
      rec.start(1000);
      setSeconds(0);
      setListening(true);
      const began = Date.now();
      timer.current = setInterval(() => {
        const s = Math.floor((Date.now() - began) / 1000);
        setSeconds(s);
        if (s >= MAX_ANSWER_SEC) stop();
      }, 250);
      // Input level for the meter, so candidates can see the microphone is hearing them.
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
        audioCtx.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let peak = 0;
          for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
          setLevel(Math.min(1, peak / 64));
          raf.current = requestAnimationFrame(tick);
        };
        tick();
      }
    } catch (e) {
      cleanup();
      setListening(false);
      setError((e as Error).name === "NotAllowedError" ? "Microphone access was blocked. Allow it in your browser, or type your answers." : "We couldn't start the microphone. Please type your answers.");
    }
  }, [cleanup, stop, upload]);

  useEffect(
    () => () => {
      const rec = recRef.current;
      if (rec && rec.state !== "inactive") {
        rec.onstop = null;
        rec.stop();
      }
      cleanup();
    },
    [cleanup],
  );

  return { listening, transcribing, seconds, level, error, start, stop };
}

/** Plays the interviewer's messages with the natural voice; one at a time, interruptible. */
export class CloudSpeaker {
  private audio: HTMLAudioElement | null = null;
  constructor(private urlFor: (messageId: string) => string) {}

  /** Resolves false if playback couldn't start (autoplay blocked or the service failed), so the caller can fall back. */
  speak(messageId: string, onEnd?: () => void): Promise<boolean> {
    this.stop();
    const a = new Audio(this.urlFor(messageId));
    this.audio = a;
    a.onended = () => {
      if (this.audio === a) this.audio = null;
      onEnd?.();
    };
    return a.play().then(
      () => true,
      () => {
        if (this.audio === a) this.audio = null;
        return false;
      },
    );
  }

  stop() {
    if (this.audio) {
      this.audio.onended = null;
      this.audio.pause();
      this.audio.src = "";
      this.audio = null;
    }
  }
}
