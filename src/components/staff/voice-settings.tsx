"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Select } from "../ui";
import { api } from "../api";
import type { VoiceSettings } from "@/lib/core/speech";

const ACCENTS = [
  { id: "en-IN", label: "Indian English" },
  { id: "en-US", label: "American English" },
  { id: "en-GB", label: "British English" },
] as const;

/** How the AI interviewer sounds in voice mode, with a sample to listen to. */
export function VoiceSettingsCard({ initial, configured }: { initial: VoiceSettings; configured: boolean }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const audio = useRef<HTMLAudioElement | null>(null);
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);

  async function play() {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/settings/voice/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accent: v.accent, gender: v.gender }) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message ?? "Couldn't play the sample.");
      audio.current?.pause();
      const a = new Audio(URL.createObjectURL(await res.blob()));
      audio.current = a;
      await a.play();
      setMsg("Playing a sample…");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="voice">
      <Card title="Interviewer voice">
        <div className="space-y-4 text-sm">
          <p className="text-slate-600">
            {configured
              ? "Natural voice uses Microsoft Azure AI Speech: the interviewer speaks with a lifelike voice, and candidates' spoken answers are turned into text by the service (more accurate for Indian accents, and it works in every modern browser). Audio is never stored."
              : "Natural voice isn't configured on this server yet (AZURE_SPEECH_KEY and AZURE_SPEECH_REGION). Until then, voice mode uses the browser's built-in speech."}
          </p>
          <fieldset>
            <legend className="mb-2 font-medium text-slate-700">Voice engine</legend>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2">
                <input type="radio" name="engine" checked={v.engine === "natural"} onChange={() => setV({ ...v, engine: "natural" })} />
                <span>Natural voice{configured ? "" : " (when configured)"}</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="engine" checked={v.engine === "browser"} onChange={() => setV({ ...v, engine: "browser" })} />
                <span>Browser&apos;s built-in speech</span>
              </label>
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="English accent" hint="Also the accent spoken answers are recognised in. Other languages use their own voices.">
              <Select value={v.accent} onChange={(e) => setV({ ...v, accent: e.target.value as VoiceSettings["accent"] })}>
                {ACCENTS.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Voice" hint="Pick the voice that suits the interviewer persona names you use on your drives.">
              <Select value={v.gender} onChange={(e) => setV({ ...v, gender: e.target.value as VoiceSettings["gender"] })}>
                <option value="female">Female</option>
                <option value="male">Male</option>
              </Select>
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={busy || !dirty}
              onClick={async () => {
                setBusy(true);
                setMsg("");
                try {
                  await api("/api/settings", { method: "PUT", body: { voice: v } });
                  setMsg("Saved.");
                  router.refresh();
                } catch (e) {
                  setMsg((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save voice
            </Button>
            <Button variant="secondary" disabled={busy || !configured} onClick={play}>
              ▶ Play a sample
            </Button>
            {msg && (
              <span role="status" className="text-slate-700">
                {msg}
              </span>
            )}
          </div>
        </div>
      </Card>
    </section>
  );
}
