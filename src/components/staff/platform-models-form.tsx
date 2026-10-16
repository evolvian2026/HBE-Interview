"use client";

import { useState } from "react";
import { Button, Card, Field, Select } from "../ui";
import { api } from "../api";
import { MODEL_CHOICES } from "@/lib/settings-shared";
import type { PlatformSettings } from "@/lib/settings";

/** Platform-wide model overrides (platform admins only): a cost/quality decision for the operator, applied to every organisation. */
export function PlatformModelsForm({ initial }: { initial: PlatformSettings }) {
  const [s, setS] = useState(initial);
  const [msg, setMsg] = useState("");
  return (
    <Card title="AI models (all organisations)">
      <p className="mb-3 text-sm text-slate-600">Override the model used at each stage. Leave on default to use the deployment configuration. New settings apply within a minute; every report records the evaluator model used.</p>
      <div className="grid gap-3 md:grid-cols-5">
        {(["interviewer", "analyzer", "evaluator", "utility"] as const).map((tier) => (
          <Field key={tier} label={{ interviewer: "Interviewer", analyzer: "JD / resume / repo analysis", evaluator: "Evaluator & combined report", utility: "Utility (compliance, redaction)" }[tier]}>
            <Select value={s.models[tier]} onChange={(e) => setS({ ...s, models: { ...s.models, [tier]: e.target.value } })}>
              <option value="">Default</option>
              {MODEL_CHOICES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
        ))}
        <Field label="Interviewer effort">
          <Select value={s.interviewerEffort} onChange={(e) => setS({ ...s, interviewerEffort: e.target.value as PlatformSettings["interviewerEffort"] })}>
            <option value="">Default</option>
            <option value="low">Low (fastest)</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </Select>
        </Field>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button
          onClick={async () => {
            setMsg("");
            try {
              setS(await api<PlatformSettings>("/api/platform/settings", { method: "PUT", body: s }));
              setMsg("Saved.");
            } catch (e) {
              setMsg((e as Error).message);
            }
          }}
        >
          Save models
        </Button>
        {msg && <span className="text-sm text-slate-600">{msg}</span>}
      </div>
    </Card>
  );
}
