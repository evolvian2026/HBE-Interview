"use client";

import { useState } from "react";
import { Button, Card, Field, Input, Textarea } from "../ui";
import { api } from "../api";
import type { OrgSettings, OrgValue } from "@/lib/settings";

export function SettingsForm({ initial }: { initial: OrgSettings }) {
  const [s, setS] = useState(initial);
  const [msg, setMsg] = useState("");
  const set = <K extends keyof OrgSettings>(k: K, v: OrgSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  const setValue = (i: number, patch: Partial<OrgValue>) => set("values", s.values.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  return (
    <>
      <Card title="Company">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Company name">
            <Input value={s.companyName} onChange={(e) => set("companyName", e.target.value)} />
          </Field>
          <Field label="Support email (shown to candidates)">
            <Input value={s.supportEmail} onChange={(e) => set("supportEmail", e.target.value)} />
          </Field>
          <Field label="About the company (shown to candidates; used by the AI to answer basic questions)" className="md:col-span-2">
            <Textarea rows={3} value={s.companyBlurb} onChange={(e) => set("companyBlurb", e.target.value)} />
          </Field>
        </div>
      </Card>
      <Card title="Company values (HR round)">
        <p className="mb-3 text-sm text-slate-600">The HR interviewer asks behavioural questions mapped to these values (3–8). Observable behaviours help the AI recognise evidence.</p>
        <div className="space-y-3">
          {s.values.map((v, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-slate-200 p-3 md:grid-cols-[1fr_2fr_2fr_auto]">
              <Input value={v.name} placeholder="Value" onChange={(e) => setValue(i, { name: e.target.value })} />
              <Input value={v.description} placeholder="Description" onChange={(e) => setValue(i, { description: e.target.value })} />
              <Input value={v.behaviors.join("; ")} placeholder="Observable behaviours (; separated)" onChange={(e) => setValue(i, { behaviors: e.target.value.split(";").map((x) => x.trim()).filter(Boolean) })} />
              <Button variant="ghost" disabled={s.values.length <= 1} onClick={() => set("values", s.values.filter((_, j) => j !== i))}>
                Remove
              </Button>
            </div>
          ))}
          {s.values.length < 8 && (
            <Button variant="secondary" onClick={() => set("values", [...s.values, { name: "", description: "", behaviors: [] }])}>
              Add value
            </Button>
          )}
        </div>
      </Card>
      <Card title="Compliance & privacy">
        <div className="space-y-4">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={s.askCompensation} onChange={(e) => set("askCompensation", e.target.checked)} />
            <span>
              HR round asks for <b>expected</b> compensation (off by default). Current or past salary is never asked.
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={s.require2fa} onChange={(e) => set("require2fa", e.target.checked)} />
            <span>
              Require <b>two-factor sign-in</b> for everyone in this organisation. Staff without it are asked to set it up at their next sign-in (Security page).
            </span>
          </label>
          <Field label="Data retention (days after the candidacy closes)" hint="Resumes, transcripts, code and reports are deleted automatically after this period.">
            <Input type="number" min={30} max={730} className="max-w-40" value={s.retentionDays} onChange={(e) => set("retentionDays", Number(e.target.value))} />
          </Field>
          <Field label={`Candidate consent text (version ${s.consentVersion}; editing creates a new version)`}>
            <Textarea rows={6} value={s.consentText} onChange={(e) => set("consentText", e.target.value)} />
          </Field>
        </div>
      </Card>
      <div className="flex items-center gap-3">
        <Button
          onClick={async () => {
            setMsg("");
            try {
              const r = await api<OrgSettings>("/api/settings", {
                method: "PUT",
                body: { companyName: s.companyName, companyBlurb: s.companyBlurb, supportEmail: s.supportEmail, values: s.values.filter((v) => v.name.trim()), askCompensation: s.askCompensation, require2fa: s.require2fa, retentionDays: s.retentionDays, consentText: s.consentText },
              });
              setS(r);
              setMsg("Saved.");
            } catch (e) {
              setMsg((e as Error).message);
            }
          }}
        >
          Save settings
        </Button>
        {msg && <span className="text-sm text-slate-600">{msg}</span>}
      </div>
    </>
  );
}
