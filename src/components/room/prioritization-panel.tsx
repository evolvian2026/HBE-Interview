"use client";

import { useEffect, useRef, useState } from "react";
import { Badge, Button, Textarea, cx } from "../ui";
import type { PrioritizationWorkspace } from "@/lib/interview/exercises";

/** Drag-and-drop ranking with keyboard-accessible move buttons and a written rationale (G-8). */
export function PrioritizationPanel({ ws, base, disabled, onSubmit }: { ws: PrioritizationWorkspace; base: string; disabled: boolean; onSubmit: () => void }) {
  const initial = ws.content.order ? ws.content.order.split(",").filter((id) => ws.items.some((i) => i.id === id)) : ws.items.map((i) => i.id);
  const [order, setOrder] = useState<string[]>([...initial, ...ws.items.map((i) => i.id).filter((id) => !initial.includes(id))]);
  const [summary, setSummary] = useState(ws.content.summary ?? "");
  const [drag, setDrag] = useState<string | null>(null);
  const [saved, setSaved] = useState<"saved" | "saving" | "error">("saved");
  const dirty = useRef(false);
  const text = (id: string) => ws.items.find((i) => i.id === id)?.text ?? id;
  const content = () => ({ order: order.join(","), ranking: order.map((id, i) => `${i + 1}. ${text(id)}`).join("\n"), summary });

  useEffect(() => {
    if (!dirty.current) return;
    setSaved("saving");
    const t = setTimeout(async () => {
      const res = await fetch(`${base}/exercise`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: content() }) }).catch(() => null);
      setSaved(res?.ok ? "saved" : "error");
    }, 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, summary]);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length) return;
    dirty.current = true;
    setOrder((o) => {
      const n = [...o];
      const [x] = n.splice(from, 1);
      n.splice(to, 0, x);
      return n;
    });
  };
  const locked = disabled || ws.submitted;
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 p-4">
        <div className="flex items-center justify-between">
          <p className="font-semibold">{ws.title}</p>
          <Badge tone={saved === "error" ? "red" : "slate"}>{ws.submitted ? "Submitted" : saved === "saving" ? "Saving…" : saved === "error" ? "Not saved" : "Saved"}</Badge>
        </div>
        <p className="mt-2 text-sm text-slate-700">{ws.brief}</p>
        <p className="mt-1 text-xs text-slate-500">Drag items to reorder (most important at the top), or use the arrow buttons.</p>
      </div>
      <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
        {order.map((id, i) => (
          <li
            key={id}
            draggable={!locked}
            onDragStart={() => setDrag(id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => drag && move(order.indexOf(drag), i)}
            onDragEnd={() => setDrag(null)}
            className={cx("flex items-center gap-3 rounded-lg border bg-white p-3 text-sm", drag === id ? "border-brand-500 opacity-60" : "border-slate-200", !locked && "cursor-grab")}
          >
            <span className="w-6 text-right font-semibold tabular-nums text-slate-500">{i + 1}</span>
            <span className="flex-1">{text(id)}</span>
            <span className="flex gap-1">
              <button aria-label={`Move "${text(id)}" up`} disabled={locked || i === 0} className="rounded px-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30" onClick={() => move(i, i - 1)}>
                ↑
              </button>
              <button aria-label={`Move "${text(id)}" down`} disabled={locked || i === order.length - 1} className="rounded px-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30" onClick={() => move(i, i + 1)}>
                ↓
              </button>
            </span>
          </li>
        ))}
      </ol>
      <div className="space-y-2 border-t border-slate-200 p-3">
        <label className="block text-sm font-medium text-slate-700">
          Rationale — why your top 3 come first, what you would defer or drop, and how you would communicate it
          <Textarea
            rows={4}
            className="mt-1"
            disabled={locked}
            value={summary}
            onChange={(e) => {
              dirty.current = true;
              setSummary(e.target.value);
            }}
          />
        </label>
        <Button
          disabled={locked || summary.trim().length < 20}
          onClick={async () => {
            if (!confirm("Submit your ranking? You won't be able to change it afterwards.")) return;
            await fetch(`${base}/exercise`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: content() }) });
            onSubmit();
          }}
        >
          {ws.submitted ? "Submitted" : "Submit ranking"}
        </Button>
      </div>
    </div>
  );
}
