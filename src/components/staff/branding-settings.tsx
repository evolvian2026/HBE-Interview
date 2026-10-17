"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input } from "../ui";
import { api } from "../api";
import { brandColorProblem, brandVars, contrast, darkEnough, HEX } from "@/lib/core/brand";

/** Candidate-facing branding: logo and brand colour, with a live preview and a readability check. */
export function BrandingSettings({ name, logoUrl, brandColor }: { name: string; logoUrl: string | null; brandColor: string | null }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [color, setColor] = useState(brandColor ?? "#4f46e5");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const valid = HEX.test(color);
  const problem = valid ? brandColorProblem(color) : "Use a hex colour like #1d4ed8";
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };
  return (
    <Card title="Branding (candidate pages)">
      <div className="grid gap-6 text-sm md:grid-cols-2">
        <div className="space-y-4">
          <div>
            <p className="font-medium">Logo</p>
            <p className="text-slate-600">PNG or JPEG, up to 200 KB. Shown with your company name on the candidate&apos;s interview pages.</p>
            <div className="mt-2 flex items-center gap-3">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt={`${name} logo`} className="h-10 w-auto max-w-[10rem] rounded border border-slate-200 bg-white object-contain p-1" />
              ) : (
                <span className="text-slate-600">No logo — candidates see HBE Interview.</span>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                aria-label="Upload logo"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const form = new FormData();
                  form.append("file", f);
                  run(() => api("/api/settings/branding/logo", { form }), "Logo updated.");
                }}
              />
              <Button variant="secondary" onClick={() => fileRef.current?.click()}>
                {logoUrl ? "Replace" : "Upload logo"}
              </Button>
              {logoUrl && (
                <Button variant="ghost" onClick={() => run(() => api("/api/settings/branding/logo", { method: "DELETE" }), "Logo removed.")}>
                  Remove
                </Button>
              )}
            </div>
          </div>
          <div>
            <Field label="Brand colour" hint="Used for buttons, links and highlights. It must keep white button text readable (contrast 4.5:1).">
              <div className="flex items-center gap-2">
                <input type="color" aria-label="Pick brand colour" value={valid ? color : "#000000"} onChange={(e) => setColor(e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-slate-300" />
                <Input className="w-32 font-mono" value={color} onChange={(e) => setColor(e.target.value.trim())} aria-label="Brand colour hex" />
                {valid && <span className="text-xs text-slate-600">contrast with white {contrast(color, "#ffffff").toFixed(1)}:1</span>}
              </div>
            </Field>
            {problem && (
              <p className="mt-1 text-xs text-red-700">
                {problem}{" "}
                {valid && (
                  <button type="button" className="underline" onClick={() => setColor(darkEnough(color))}>
                    Use {darkEnough(color)}
                  </button>
                )}
              </p>
            )}
            <div className="mt-2 flex gap-2">
              <Button disabled={!!problem} onClick={() => run(() => api("/api/settings/branding", { method: "PUT", body: { brandColor: color } }), "Brand colour saved.")}>
                Save colour
              </Button>
              {brandColor && (
                <Button variant="ghost" onClick={() => run(() => api("/api/settings/branding", { method: "PUT", body: { brandColor: null } }), "Brand colour reset.")}>
                  Reset to default
                </Button>
              )}
            </div>
          </div>
          {msg && (
            <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-emerald-700" : "text-red-700"}>
              {msg.text}
            </p>
          )}
        </div>
        <div>
          <p className="mb-2 font-medium">Preview</p>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4" style={valid && !problem ? (brandVars(color) as React.CSSProperties) : undefined}>
            <p className="text-xs font-medium uppercase tracking-wide text-brand-700">{name}</p>
            <p className="mt-1 font-semibold">Senior Backend Engineer</p>
            <div className="mt-3 rounded-lg border border-brand-200 bg-brand-50 p-3">
              <p>Round 1: Technical / Functional Round</p>
              <button type="button" className="mt-2 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white">
                Start round
              </button>
            </div>
            <p className="mt-3 text-sm">
              Questions? <span className="text-brand-700 underline">Contact the hiring team</span>
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
}
