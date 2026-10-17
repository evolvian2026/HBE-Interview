"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Textarea } from "../ui";
import { api } from "../api";
import type { ParsedResume } from "@/lib/ai/analyzers";

export function ProfileStep({ token, profile: initial }: { token: string; profile: ParsedResume }) {
  const router = useRouter();
  const [p, setP] = useState<ParsedResume>(initial);
  const [skill, setSkill] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof ParsedResume>(k: K, v: ParsedResume[K]) => setP((x) => ({ ...x, [k]: v }));

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/c/${token}/resume`, { method: "PUT", body: { profile: p } });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Review your profile</h2>
        <p className="text-sm text-slate-600">This is what the AI understood from your resume. Fix anything that&apos;s wrong — changes are visible to the hiring team.</p>
      </div>
      <Field label="Summary">
        <Textarea rows={3} value={p.summary} onChange={(e) => set("summary", e.target.value)} />
      </Field>
      <div>
        <p className="mb-1 text-sm font-medium text-slate-700">Skills</p>
        <div className="flex flex-wrap gap-2">
          {p.skills.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs">
              {s.name}
              <button aria-label={`Remove ${s.name}`} className="text-slate-500 hover:text-red-600" onClick={() => set("skills", p.skills.filter((x) => x.name !== s.name))}>
                ×
              </button>
            </span>
          ))}
        </div>
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const v = skill.trim();
            if (v && !p.skills.some((s) => s.name.toLowerCase() === v.toLowerCase())) set("skills", [...p.skills, { name: v, category: "tool", evidence: "listed" }]);
            setSkill("");
          }}
        >
          <Input placeholder="Add a skill" value={skill} onChange={(e) => setSkill(e.target.value)} className="max-w-xs" />
          <Button variant="secondary" type="submit">Add</Button>
        </form>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">Experience</p>
        <div className="space-y-3">
          {p.experience.map((e, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-4">
              <Input value={e.title} placeholder="Title" onChange={(ev) => set("experience", p.experience.map((x, j) => (j === i ? { ...x, title: ev.target.value } : x)))} />
              <Input value={e.company} placeholder="Company" onChange={(ev) => set("experience", p.experience.map((x, j) => (j === i ? { ...x, company: ev.target.value } : x)))} />
              <Input value={e.start} placeholder="Start" onChange={(ev) => set("experience", p.experience.map((x, j) => (j === i ? { ...x, start: ev.target.value } : x)))} />
              <div className="flex gap-2">
                <Input value={e.end} placeholder="End" onChange={(ev) => set("experience", p.experience.map((x, j) => (j === i ? { ...x, end: ev.target.value } : x)))} />
                <Button variant="ghost" onClick={() => set("experience", p.experience.filter((_, j) => j !== i))} aria-label="Remove">×</Button>
              </div>
            </div>
          ))}
          <Button variant="secondary" onClick={() => set("experience", [...p.experience, { company: "", title: "", start: "", end: "", bullets: [], technologies: [], teamSizeManaged: null }])}>
            Add experience
          </Button>
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">Projects</p>
        <div className="space-y-3">
          {p.projects.map((pr, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-slate-200 p-3">
              <div className="flex gap-2">
                <Input value={pr.name} placeholder="Project name" onChange={(ev) => set("projects", p.projects.map((x, j) => (j === i ? { ...x, name: ev.target.value } : x)))} />
                <Button variant="ghost" onClick={() => set("projects", p.projects.filter((_, j) => j !== i))} aria-label="Remove">×</Button>
              </div>
              <Textarea rows={2} value={pr.description} placeholder="What it does and your role" onChange={(ev) => set("projects", p.projects.map((x, j) => (j === i ? { ...x, description: ev.target.value } : x)))} />
              <Input
                value={pr.techStack.join(", ")}
                placeholder="Technologies (comma separated)"
                onChange={(ev) => set("projects", p.projects.map((x, j) => (j === i ? { ...x, techStack: ev.target.value.split(",").map((t) => t.trim()).filter(Boolean) } : x)))}
              />
            </div>
          ))}
          <Button variant="secondary" onClick={() => set("projects", [...p.projects, { name: "", description: "", techStack: [], role: "", links: [] }])}>
            Add project
          </Button>
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button onClick={confirm} disabled={busy}>
        {busy ? "Saving…" : "Confirm profile"}
      </Button>
    </div>
  );
}
