"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Opt-in webcam proctoring (K-7): shows a small self-view and uploads a 320×240 JPEG every `intervalSec`.
 * Reports "camera_off" if the camera is unavailable or stops; the interview continues regardless.
 */
export function WebcamProctor({ base, intervalSec, active, onCameraOff }: { base: string; intervalSec: number; active: boolean; onCameraOff: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"starting" | "on" | "off">("starting");

  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    const capture = () => {
      const v = videoRef.current;
      if (!v || v.readyState < 2) return;
      const c = document.createElement("canvas");
      c.width = 320;
      c.height = 240;
      c.getContext("2d")!.drawImage(v, 0, 0, 320, 240);
      const image = c.toDataURL("image/jpeg", 0.6);
      fetch(`${base}/snapshot`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image }) }).catch(() => undefined);
    };
    navigator.mediaDevices
      ?.getUserMedia({ video: { width: 320, height: 240 }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (videoRef.current) videoRef.current.srcObject = s;
        setStatus("on");
        s.getVideoTracks()[0]?.addEventListener("ended", () => {
          setStatus("off");
          onCameraOff();
        });
        setTimeout(capture, 5000);
        timer = setInterval(capture, intervalSec * 1000);
      })
      .catch(() => {
        setStatus("off");
        onCameraOff();
      });
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [active, base, intervalSec, onCameraOff]);

  if (!active) return null;
  return (
    <div className="flex items-center gap-2 text-xs text-slate-500" title="Webcam proctoring is on: periodic low-resolution snapshots (no face recognition)">
      <video ref={videoRef} autoPlay muted playsInline className="h-9 w-12 rounded bg-slate-200 object-cover" />
      <span className={status === "on" ? "text-emerald-700" : status === "off" ? "text-amber-700" : ""}>{status === "on" ? "● Camera on" : status === "off" ? "Camera unavailable" : "Starting camera…"}</span>
    </div>
  );
}
