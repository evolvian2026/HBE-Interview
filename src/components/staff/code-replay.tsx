"use client";

import { useEffect, useState } from "react";
import { Badge, Button } from "../ui";

export interface ReplayFrame {
  at: string;
  kind: string;
  language: string;
  code: string;
  passed?: number;
  total?: number;
}

/** Step through editor snapshots, runs and submissions to see how the solution evolved (F-6). */
export function CodeReplay({ frames }: { frames: ReplayFrame[] }) {
  const [i, setI] = useState(frames.length - 1);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setI((x) => (x >= frames.length - 1 ? (setPlaying(false), x) : x + 1)), 900);
    return () => clearInterval(t);
  }, [playing, frames.length]);
  if (!frames.length) return null;
  const f = frames[Math.max(0, Math.min(i, frames.length - 1))];
  const start = Date.parse(frames[0].at);
  return (
    <div className="mt-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => (i >= frames.length - 1 ? (setI(0), setPlaying(true)) : setPlaying(!playing))}>
          {playing ? "Pause" : "▶ Replay"}
        </Button>
        <input type="range" min={0} max={frames.length - 1} value={i} onChange={(e) => { setPlaying(false); setI(Number(e.target.value)); }} className="w-56" aria-label="Replay position" />
        <span className="tabular-nums text-slate-600">
          {i + 1}/{frames.length} · +{Math.round((Date.parse(f.at) - start) / 1000)}s · {f.language}
        </span>
        <Badge tone={f.kind === "submit" ? "green" : f.kind === "run" ? "blue" : "slate"}>{f.kind}</Badge>
        {f.total != null && <span className="text-slate-600">{f.passed}/{f.total} tests</span>}
      </div>
      <pre className="max-h-80 overflow-auto rounded bg-slate-900 p-2 text-xs text-slate-100">{f.code}</pre>
    </div>
  );
}
