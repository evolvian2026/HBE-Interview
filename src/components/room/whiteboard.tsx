"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, cx } from "../ui";

/** Vector shapes for the system-design whiteboard (F-10). */
export type Shape =
  | { id: string; type: "rect" | "ellipse"; x: number; y: number; w: number; h: number; label?: string }
  | { id: string; type: "arrow"; x: number; y: number; x2: number; y2: number; label?: string }
  | { id: string; type: "text"; x: number; y: number; text: string }
  | { id: string; type: "pen"; points: [number, number][] };

type Tool = "select" | "rect" | "ellipse" | "arrow" | "text" | "pen";

const W = 1000;
const H = 650;
const INK = "#0f172a";
const ACCENT = "#2a78d6";
const uid = () => Math.random().toString(36).slice(2, 9);

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** Render shapes to an SVG string (used for both display-export and the PNG sent to the AI). */
export function shapesToSvg(shapes: Shape[]): string {
  const body = shapes
    .map((s) => {
      if (s.type === "rect")
        return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="6" fill="#fff" stroke="${INK}" stroke-width="2"/>${s.label ? `<text x="${s.x + s.w / 2}" y="${s.y + s.h / 2}" font-size="15" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle" fill="${INK}">${esc(s.label)}</text>` : ""}`;
      if (s.type === "ellipse")
        return `<ellipse cx="${s.x + s.w / 2}" cy="${s.y + s.h / 2}" rx="${Math.abs(s.w / 2)}" ry="${Math.abs(s.h / 2)}" fill="#fff" stroke="${INK}" stroke-width="2"/>${s.label ? `<text x="${s.x + s.w / 2}" y="${s.y + s.h / 2}" font-size="15" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle" fill="${INK}">${esc(s.label)}</text>` : ""}`;
      if (s.type === "arrow")
        return `<line x1="${s.x}" y1="${s.y}" x2="${s.x2}" y2="${s.y2}" stroke="${INK}" stroke-width="2" marker-end="url(#ah)"/>${s.label ? `<text x="${(s.x + s.x2) / 2}" y="${(s.y + s.y2) / 2 - 6}" font-size="13" font-family="sans-serif" text-anchor="middle" fill="${INK}" stroke="#fff" stroke-width="4" paint-order="stroke">${esc(s.label)}</text>` : ""}`;
      if (s.type === "text") return `<text x="${s.x}" y="${s.y}" font-size="16" font-family="sans-serif" fill="${INK}">${esc(s.text)}</text>`;
      if (s.type === "pen") return `<polyline points="${s.points.map((p) => p.join(",")).join(" ")}" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
      return "";
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${INK}"/></marker></defs><rect width="100%" height="100%" fill="#fff"/>${body}</svg>`;
}

async function svgToPng(svg: string): Promise<string> {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("render failed"));
      img.src = url;
    });
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    c.getContext("2d")!.drawImage(img, 0, 0);
    return c.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function bbox(s: Shape) {
  if (s.type === "rect" || s.type === "ellipse") return { x: Math.min(s.x, s.x + s.w), y: Math.min(s.y, s.y + s.h), w: Math.abs(s.w), h: Math.abs(s.h) };
  if (s.type === "arrow") return { x: Math.min(s.x, s.x2) - 6, y: Math.min(s.y, s.y2) - 6, w: Math.abs(s.x2 - s.x) + 12, h: Math.abs(s.y2 - s.y) + 12 };
  if (s.type === "text") return { x: s.x, y: s.y - 16, w: s.text.length * 8 + 4, h: 20 };
  if (s.type !== "pen") return { x: 0, y: 0, w: 0, h: 0 };
  const xs = s.points.map((p) => p[0]);
  const ys = s.points.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

function moved(s: Shape, dx: number, dy: number): Shape {
  if (s.type === "arrow") return { ...s, x: s.x + dx, y: s.y + dy, x2: s.x2 + dx, y2: s.y2 + dy };
  if (s.type === "pen") return { ...s, points: s.points.map(([x, y]) => [x + dx, y + dy] as [number, number]) };
  return { ...s, x: s.x + dx, y: s.y + dy } as Shape;
}

export function Whiteboard({ initial, disabled, onSave }: { initial: Shape[]; disabled: boolean; onSave: (shapes: Shape[], png: string) => Promise<boolean> }) {
  const [shapes, setShapes] = useState<Shape[]>(initial);
  const [history, setHistory] = useState<Shape[][]>([]);
  const [tool, setTool] = useState<Tool>("rect");
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [saved, setSaved] = useState<"saved" | "saving" | "error">("saved");
  const drag = useRef<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dirty = useRef(false);

  const commit = useCallback((next: Shape[]) => {
    setHistory((h) => [...h.slice(-50), shapes]);
    setShapes(next);
    dirty.current = true;
  }, [shapes]);

  useEffect(() => {
    if (!dirty.current) return;
    setSaved("saving");
    const t = setTimeout(async () => {
      try {
        const ok = await onSave(shapes, await svgToPng(shapesToSvg(shapes)));
        setSaved(ok ? "saved" : "error");
      } catch {
        setSaved("error");
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [shapes, onSave]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selected && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        commit(shapes.filter((s) => s.id !== selected));
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, shapes, commit]);

  const pt = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: Math.round(((e.clientX - r.left) / r.width) * W), y: Math.round(((e.clientY - r.top) / r.height) * H) };
  };

  function down(e: React.PointerEvent) {
    if (disabled) return;
    const p = pt(e);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (tool === "select") {
      const hit = [...shapes].reverse().find((s) => {
        const b = bbox(s);
        return p.x >= b.x - 4 && p.x <= b.x + b.w + 4 && p.y >= b.y - 4 && p.y <= b.y + b.h + 4;
      });
      setSelected(hit?.id ?? null);
      drag.current = hit ? p : null;
      if (hit) setHistory((h) => [...h.slice(-50), shapes]);
      return;
    }
    if (tool === "text") {
      const text = prompt("Text");
      if (text?.trim()) commit([...shapes, { id: uid(), type: "text", x: p.x, y: p.y, text: text.trim().slice(0, 120) }]);
      return;
    }
    const id = uid();
    if (tool === "pen") setDraft({ id, type: "pen", points: [[p.x, p.y]] });
    else if (tool === "arrow") setDraft({ id, type: "arrow", x: p.x, y: p.y, x2: p.x, y2: p.y });
    else setDraft({ id, type: tool, x: p.x, y: p.y, w: 0, h: 0 });
  }

  function move(e: React.PointerEvent) {
    const p = pt(e);
    if (tool === "select" && drag.current && selected) {
      const dx = p.x - drag.current.x;
      const dy = p.y - drag.current.y;
      drag.current = p;
      setShapes((ss) => ss.map((s) => (s.id === selected ? moved(s, dx, dy) : s)));
      dirty.current = true;
      return;
    }
    if (!draft) return;
    if (draft.type === "pen") setDraft({ ...draft, points: [...draft.points, [p.x, p.y]] });
    else if (draft.type === "arrow") setDraft({ ...draft, x2: p.x, y2: p.y });
    else if (draft.type === "rect" || draft.type === "ellipse") setDraft({ ...draft, w: p.x - draft.x, h: p.y - draft.y });
  }

  function up() {
    drag.current = null;
    if (!draft) return;
    const b = bbox(draft);
    if (b.w < 6 && b.h < 6) {
      setDraft(null);
      return;
    }
    let s = draft;
    if (s.type === "rect" || s.type === "ellipse") {
      s = { ...s, x: b.x, y: b.y, w: b.w, h: b.h };
      const label = prompt("Label (optional), e.g. API gateway, Postgres, Queue");
      if (label?.trim()) s = { ...s, label: label.trim().slice(0, 60) };
    } else if (s.type === "arrow") {
      const label = prompt("Arrow label (optional), e.g. REST, async event");
      if (label?.trim()) s = { ...s, label: label.trim().slice(0, 40) };
    }
    commit([...shapes, s]);
    setDraft(null);
  }

  const all = draft ? [...shapes, draft] : shapes;
  const sel = shapes.find((s) => s.id === selected);
  const tools: { id: Tool; label: string }[] = [
    { id: "select", label: "Select / move" },
    { id: "rect", label: "Box" },
    { id: "ellipse", label: "Ellipse" },
    { id: "arrow", label: "Arrow" },
    { id: "text", label: "Text" },
    { id: "pen", label: "Pen" },
  ];
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 p-2 text-xs">
        {tools.map((t) => (
          <button
            key={t.id}
            disabled={disabled}
            onClick={() => setTool(t.id)}
            aria-pressed={tool === t.id}
            className={cx("rounded-md px-2.5 py-1.5", tool === t.id ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200")}
          >
            {t.label}
          </button>
        ))}
        <Button variant="ghost" className="px-2 py-1 text-xs" disabled={disabled || !history.length} onClick={() => { setShapes(history[history.length - 1]); setHistory((h) => h.slice(0, -1)); dirty.current = true; }}>
          Undo
        </Button>
        <Button variant="ghost" className="px-2 py-1 text-xs" disabled={disabled || !sel} onClick={() => { commit(shapes.filter((s) => s.id !== selected)); setSelected(null); }}>
          Delete
        </Button>
        <Button variant="ghost" className="px-2 py-1 text-xs" disabled={disabled || !shapes.length} onClick={() => confirm("Clear the whole whiteboard?") && commit([])}>
          Clear
        </Button>
        <span className="ml-auto text-slate-500">{saved === "saving" ? "Saving…" : saved === "error" ? "Not saved" : "Saved"} · the interviewer can see this board</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-2">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className={cx("w-full touch-none rounded border border-slate-200 bg-white", disabled ? "cursor-not-allowed" : tool === "select" ? "cursor-default" : "cursor-crosshair")}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          role="img"
          aria-label="System design whiteboard"
          dangerouslySetInnerHTML={{
            __html:
              shapesToSvg(all).replace(/^<svg[^>]*>|<\/svg>$/g, "") +
              (sel ? `<rect x="${bbox(sel).x - 4}" y="${bbox(sel).y - 4}" width="${bbox(sel).w + 8}" height="${bbox(sel).h + 8}" fill="none" stroke="${ACCENT}" stroke-dasharray="4 3"/>` : ""),
          }}
        />
        <p className="mt-1 text-xs text-slate-500">Draw boxes for components and arrows for data flow; you&apos;ll be asked for labels. Select a shape to move it, Delete to remove it.</p>
      </div>
    </div>
  );
}
