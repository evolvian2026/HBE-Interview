"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Textarea } from "../ui";
import type { TextExerciseWorkspace } from "@/lib/interview/exercises";
import { Whiteboard, type Shape } from "./whiteboard";

export function TextExercisePanel({ ws, base, disabled, onSubmit, onPaste }: { ws: TextExerciseWorkspace; base: string; disabled: boolean; onSubmit: () => void; onPaste: (n: number) => void }) {
  const [content, setContent] = useState<Record<string, string>>(ws.content ?? {});
  const [saved, setSaved] = useState<"saved" | "saving" | "error">("saved");
  const dirty = useRef(false);
  const [tab, setTab] = useState<"notes" | "board">("notes");
  const saveBoard = useCallback(
    async (shapes: Shape[], png: string) => {
      const res = await fetch(`${base}/whiteboard`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ shapes, png }) }).catch(() => null);
      return !!res?.ok;
    },
    [base],
  );

  useEffect(() => {
    if (!dirty.current) return;
    setSaved("saving");
    const t = setTimeout(async () => {
      const res = await fetch(`${base}/exercise`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ content }) }).catch(() => null);
      setSaved(res?.ok ? "saved" : "error");
    }, 1200);
    return () => clearTimeout(t);
  }, [content, base]);

  const locked = disabled || ws.submitted;
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold">{ws.title}</p>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>~{ws.minutes} min</span>
            <Badge tone={saved === "error" ? "red" : "slate"}>{ws.submitted ? "Submitted" : saved === "saving" ? "Saving…" : saved === "error" ? "Not saved" : "Saved"}</Badge>
          </div>
        </div>
        <p className="mt-2 text-sm text-slate-700">{ws.brief}</p>
        {ws.kind === "system_design" && (
          <div className="mt-3 flex gap-1 text-xs" role="tablist">
            {(["notes", "board"] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1.5 ${tab === t ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700"}`}>
                {t === "notes" ? "Written design" : "Whiteboard"}
              </button>
            ))}
          </div>
        )}
      </div>
      {ws.kind === "system_design" && tab === "board" ? (
        <div className="min-h-0 flex-1">
          <Whiteboard initial={(ws.whiteboard as Shape[]) ?? []} disabled={locked} onSave={saveBoard} />
        </div>
      ) : (
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {ws.template.map((t) => (
          <label key={t.key} className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">{t.label}</span>
            <Textarea
              rows={4}
              disabled={locked}
              value={content[t.key] ?? ""}
              onPaste={(e) => onPaste(e.clipboardData.getData("text").length)}
              onChange={(e) => {
                dirty.current = true;
                setContent((c) => ({ ...c, [t.key]: e.target.value }));
              }}
            />
          </label>
        ))}
      </div>
      )}
      <div className="border-t border-slate-200 p-3">
        <Button
          disabled={locked}
          onClick={async () => {
            if (!confirm("Submit your response? You won't be able to edit it afterwards.")) return;
            await fetch(`${base}/exercise`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ content }) });
            onSubmit();
          }}
        >
          {ws.submitted ? "Submitted" : "Submit response"}
        </Button>
      </div>
    </div>
  );
}
