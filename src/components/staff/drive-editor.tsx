"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Field, Input, Select, Textarea, cx } from "../ui";
import { api } from "../api";
import { buildDefaultDriveConfig, enabledRounds, rescaleSections, validateDriveConfig } from "@/lib/core/rounds";
import { PARAMETERS } from "@/lib/core/rubrics";
import { INTERVIEW_LANGUAGES } from "@/lib/core/languages";
import {
  CATEGORY_LABEL,
  RECOMMENDATION_LABEL,
  ROUND_LABEL,
  SENIORITY_LABEL,
  type DriveConfig,
  type Language,
  type Recommendation,
  type RoundConfig,
  type RoundType,
} from "@/lib/core/types";

const LANGS: { id: Language; label: string }[] = [
  { id: "python", label: "Python" },
  { id: "javascript", label: "JavaScript" },
  { id: "java", label: "Java" },
  { id: "cpp", label: "C++" },
];

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export function DriveEditor({ driveId, initial, published }: { driveId: string; initial: DriveConfig; published: boolean }) {
  const router = useRouter();
  const [c, setC] = useState<DriveConfig>(initial);
  const [busy, setBusy] = useState<"" | "save" | "publish" | "analyze">("");
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const issues = useMemo(() => validateDriveConfig(c), [c]);
  const update = (patch: Partial<DriveConfig>) => setC((x) => ({ ...x, ...patch }));
  const updateRound = (type: RoundType, patch: Partial<RoundConfig>) => setC((x) => ({ ...x, rounds: x.rounds.map((r) => (r.type === type ? { ...r, ...patch } : r)) }));
  const profile = c.roleProfile;
  const enabled = enabledRounds(c);

  async function save(): Promise<boolean> {
    setBusy("save");
    setMsg(null);
    try {
      await api(`/api/drives/${driveId}`, { method: "PUT", body: { config: c } });
      setMsg({ tone: "green", text: "Draft saved." });
      return true;
    } catch (e) {
      setMsg({ tone: "red", text: (e as Error).message });
      return false;
    } finally {
      setBusy("");
    }
  }

  async function publish() {
    if (!(await save())) return;
    setBusy("publish");
    try {
      const { version } = await api<{ version: number }>(`/api/drives/${driveId}/publish`, { body: {} });
      setMsg({ tone: "green", text: `Published version ${version}.` });
      router.push(`/app/drives/${driveId}`);
      router.refresh();
    } catch (e) {
      setMsg({ tone: "red", text: (e as Error).message });
    } finally {
      setBusy("");
    }
  }

  function applyRecommendedRounds() {
    const fresh = buildDefaultDriveConfig(c.title, c.jdText, c.roleProfile);
    setC((x) => ({ ...x, rounds: fresh.rounds, roundWeights: fresh.roundWeights, coding: { ...x.coding, difficulty: fresh.coding.difficulty } }));
  }

  return (
    <div className="space-y-6">
      {/* ---------------- Role profile ---------------- */}
      <Card
        title="1. Role profile"
        actions={
          <Button
            variant="secondary"
            disabled={!!busy}
            onClick={async () => {
              if (!confirm("Re-run the AI analysis of the JD? This resets rounds and rubrics to the recommended defaults.")) return;
              setBusy("analyze");
              try {
                const { config } = await api<{ config: DriveConfig }>(`/api/drives/${driveId}/analyze`, { body: {} });
                setC(config);
              } catch (e) {
                setMsg({ tone: "red", text: (e as Error).message });
              } finally {
                setBusy("");
              }
            }}
          >
            {busy === "analyze" ? "Analysing…" : "Re-analyse JD"}
          </Button>
        }
      >
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Role title" className="md:col-span-3">
            <Input value={c.title} onChange={(e) => update({ title: e.target.value })} />
          </Field>
          <Field label="Category">
            <Select value={profile.category} onChange={(e) => update({ roleProfile: { ...profile, category: e.target.value as typeof profile.category } })}>
              {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Seniority">
            <Select value={profile.seniority} onChange={(e) => update({ roleProfile: { ...profile, seniority: e.target.value as typeof profile.seniority } })}>
              {Object.entries(SENIORITY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Track">
            <Select value={profile.track} onChange={(e) => update({ roleProfile: { ...profile, track: e.target.value as typeof profile.track } })}>
              <option value="ic">Individual contributor</option>
              <option value="manager">People manager</option>
            </Select>
          </Field>
          <Field label="Must-have skills (comma separated)" className="md:col-span-3">
            <Input value={profile.mustHaveSkills.join(", ")} onChange={(e) => update({ roleProfile: { ...profile, mustHaveSkills: list(e.target.value) } })} />
          </Field>
          <Field label="Nice-to-have skills (comma separated)" className="md:col-span-3">
            <Input value={profile.niceToHaveSkills.join(", ")} onChange={(e) => update({ roleProfile: { ...profile, niceToHaveSkills: list(e.target.value) } })} />
          </Field>
          <Field label="Domain">
            <Input value={profile.domain} onChange={(e) => update({ roleProfile: { ...profile, domain: e.target.value } })} />
          </Field>
          <Field label="Leadership expectations (one per line)" className="md:col-span-2">
            <Textarea
              rows={2}
              value={profile.leadershipExpectations.join("\n")}
              onChange={(e) => update({ roleProfile: { ...profile, leadershipExpectations: e.target.value.split("\n").filter((x) => x.trim()) } })}
            />
          </Field>
          <Field label="Role summary" className="md:col-span-3">
            <Textarea rows={2} value={profile.summary} onChange={(e) => update({ roleProfile: { ...profile, summary: e.target.value } })} />
          </Field>
          <details className="md:col-span-3">
            <summary className="cursor-pointer text-sm text-slate-600">Job description</summary>
            <Textarea className="mt-2" rows={10} value={c.jdText} onChange={(e) => update({ jdText: e.target.value })} />
          </details>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-3 text-sm">
          <span className="text-slate-600">Changed seniority, track or category?</span>
          <Button variant="secondary" onClick={applyRecommendedRounds}>
            Apply recommended rounds & weights
          </Button>
        </div>
      </Card>

      {/* ---------------- Rounds ---------------- */}
      <Card title="2. Interview rounds & gates">
        <p className="mb-4 text-sm text-slate-600">
          Order is fixed: Technical / Functional → Managerial (senior roles) → HR (always last). Currently enabled:{" "}
          {enabled.map((r) => ROUND_LABEL[r.type]).join(" → ") || "none"}.
        </p>
        <div className="space-y-5">
          {c.rounds.map((r) => {
            const isLastEnabled = enabled[enabled.length - 1]?.type === r.type;
            const total = r.sections.filter((s) => s.enabled).reduce((a, s) => a + s.minutes, 0);
            return (
              <div key={r.type} className={cx("rounded-xl border p-4", r.enabled ? "border-slate-200" : "border-dashed border-slate-300 opacity-70")}>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 font-medium">
                    <input type="checkbox" checked={r.enabled} onChange={(e) => updateRound(r.type, { enabled: e.target.checked })} />
                    {ROUND_LABEL[r.type]}
                  </label>
                  {r.type === "managerial" && <Badge>Recommended for Senior and above</Badge>}
                  {r.type === "hr" && <Badge>Always last</Badge>}
                  {r.type === "technical" && !r.enabled && <Badge tone="amber">Technical round disabled</Badge>}
                  <div className="ml-auto flex items-center gap-2 text-sm">
                    <span className="text-slate-500">Interviewer name</span>
                    <Input className="w-28" value={r.personaName} onChange={(e) => updateRound(r.type, { personaName: e.target.value })} />
                    <span className="text-slate-500">Duration</span>
                    <Input className="w-20" type="number" min={10} max={120} value={r.durationMin} onChange={(e) => updateRound(r.type, { durationMin: Number(e.target.value) })} />
                    <span className="text-slate-500">min</span>
                  </div>
                </div>
                {r.enabled && (
                  <>
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="text-left text-xs text-slate-500">
                          <tr>
                            <th className="py-1 pr-2">On</th>
                            <th className="py-1 pr-2">Section</th>
                            <th className="py-1 pr-2">Minutes</th>
                            <th className="py-1 pr-2">Min Q</th>
                            <th className="py-1 pr-2">Max Q</th>
                            <th className="py-1">Exercise</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.sections.map((s, i) => (
                            <tr key={s.key}>
                              <td className="py-1 pr-2">
                                <input
                                  type="checkbox"
                                  checked={s.enabled}
                                  disabled={s.key === "intro" || s.key === "wrapup"}
                                  onChange={(e) => updateRound(r.type, { sections: r.sections.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)) })}
                                />
                              </td>
                              <td className="py-1 pr-2">
                                <Input value={s.title} onChange={(e) => updateRound(r.type, { sections: r.sections.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
                              </td>
                              {(["minutes", "minQ", "maxQ"] as const).map((k) => (
                                <td key={k} className="py-1 pr-2">
                                  <Input
                                    className="w-20"
                                    type="number"
                                    min={k === "minQ" ? 0 : 1}
                                    value={s[k]}
                                    onChange={(e) => updateRound(r.type, { sections: r.sections.map((x, j) => (j === i ? { ...x, [k]: Number(e.target.value) } : x)) })}
                                  />
                                </td>
                              ))}
                              <td className="py-1 text-xs text-slate-500">{s.exercise?.replace("_", " ") ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-xs">
                      <span className={cx(total === r.durationMin ? "text-slate-500" : "text-amber-700")}>
                        Sections total {total} min (round {r.durationMin} min)
                      </span>
                      {total !== r.durationMin && (
                        <button className="text-brand-600 hover:underline" onClick={() => updateRound(r.type, rescaleSections(r))}>
                          Rescale sections to fit
                        </button>
                      )}
                    </div>
                    <Field label="Questions the AI must include (one per line, max 5)" className="mt-3">
                      <Textarea
                        rows={2}
                        value={r.pinnedQuestions.join("\n")}
                        onChange={(e) => updateRound(r.type, { pinnedQuestions: e.target.value.split("\n").filter((x) => x.trim()).slice(0, 5) })}
                      />
                    </Field>
                    {!isLastEnabled && (
                      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-3 text-sm">
                        <span className="font-medium">Gate to next round:</span>
                        <Select className="w-56" value={r.gate.mode} onChange={(e) => updateRound(r.type, { gate: { ...r.gate, mode: e.target.value as RoundConfig["gate"]["mode"] } })}>
                          <option value="auto">Auto-advance at threshold</option>
                          <option value="manual">Recruiter decides</option>
                          <option value="always">Always advance</option>
                        </Select>
                        {r.gate.mode === "auto" && (
                          <>
                            <span>if recommendation ≥</span>
                            <Select className="w-40" value={r.gate.threshold} onChange={(e) => updateRound(r.type, { gate: { ...r.gate, threshold: e.target.value as Recommendation } })}>
                              {(["strong_hire", "hire", "lean_no"] as Recommendation[]).map((x) => (
                                <option key={x} value={x}>
                                  {RECOMMENDATION_LABEL[x]}
                                </option>
                              ))}
                            </Select>
                            <span className="text-slate-500">(otherwise the recruiter decides)</span>
                          </>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* ---------------- Rubrics ---------------- */}
      <Card title="3. Scoring">
        <div className="grid gap-6 lg:grid-cols-3">
          {enabled.map((r) => {
            const sum = Object.values(r.weights).reduce((a, b) => a + b, 0);
            return (
              <div key={r.type}>
                <p className="mb-2 flex items-center justify-between text-sm font-medium">
                  {ROUND_LABEL[r.type]} <Badge tone={sum === 100 ? "green" : "red"}>{sum}%</Badge>
                </p>
                <div className="space-y-1">
                  {PARAMETERS[r.type].map((p) => (
                    <label key={p.id} className="flex items-center justify-between gap-2 text-sm" title={p.description}>
                      <span className="text-slate-700">{p.label}</span>
                      <Input
                        className="w-20"
                        type="number"
                        min={0}
                        max={100}
                        value={r.weights[p.id] ?? 0}
                        onChange={(e) => updateRound(r.type, { weights: { ...r.weights, [p.id]: Number(e.target.value) } })}
                      />
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-6 grid gap-6 md:grid-cols-3">
          <div>
            <p className="mb-2 text-sm font-medium">
              Round weights in final score{" "}
              <Badge tone={enabled.reduce((a, r) => a + (c.roundWeights[r.type] ?? 0), 0) === 100 ? "green" : "red"}>
                {enabled.reduce((a, r) => a + (c.roundWeights[r.type] ?? 0), 0)}%
              </Badge>
            </p>
            {enabled.map((r) => (
              <label key={r.type} className="mb-1 flex items-center justify-between gap-2 text-sm">
                <span>{ROUND_LABEL[r.type]}</span>
                <Input className="w-20" type="number" value={c.roundWeights[r.type]} onChange={(e) => update({ roundWeights: { ...c.roundWeights, [r.type]: Number(e.target.value) } })} />
              </label>
            ))}
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Recommendation bands (score ≥)</p>
            {(
              [
                ["strongHire", "Strong Hire"],
                ["hire", "Hire"],
                ["leanNo", "Lean No"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="mb-1 flex items-center justify-between gap-2 text-sm">
                <span>{label}</span>
                <Input className="w-20" type="number" value={c.bands[k]} onChange={(e) => update({ bands: { ...c.bands, [k]: Number(e.target.value) } })} />
              </label>
            ))}
            <p className="text-xs text-slate-500">Below Lean No = No Hire.</p>
          </div>
          <div className="space-y-2 text-sm">
            <p className="font-medium">Knockout rules</p>
            <label className="flex gap-2">
              <input type="checkbox" checked={c.knockouts.authenticity} onChange={(e) => update({ knockouts: { ...c.knockouts, authenticity: e.target.checked } })} />
              Authenticity ≤ 2 caps the Technical round at Lean No
            </label>
            <label className="flex gap-2">
              <input type="checkbox" checked={c.knockouts.ethics} onChange={(e) => update({ knockouts: { ...c.knockouts, ethics: e.target.checked } })} />
              Failed ethics scenario caps the Managerial round at Lean No
            </label>
            <label className="flex gap-2">
              <input type="checkbox" checked={c.knockouts.noHireCap} onChange={(e) => update({ knockouts: { ...c.knockouts, noHireCap: e.target.checked } })} />
              Any round rated No Hire caps the final at Lean No
            </label>
          </div>
        </div>
      </Card>

      {/* ---------------- Settings ---------------- */}
      <Card title="4. Settings">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-3">
            <p className="text-sm font-medium">Live coding</p>
            <div className="flex flex-wrap gap-3 text-sm">
              {LANGS.map((l) => (
                <label key={l.id} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={c.coding.languages.includes(l.id)}
                    onChange={(e) => update({ coding: { ...c.coding, languages: e.target.checked ? [...c.coding.languages, l.id] : c.coding.languages.filter((x) => x !== l.id) } })}
                  />
                  {l.label}
                </label>
              ))}
            </div>
            <div className="flex flex-wrap gap-3 text-sm">
              <span className="text-slate-600">Difficulty:</span>
              {(["easy", "medium", "hard"] as const).map((d) => (
                <label key={d} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={c.coding.difficulty.includes(d)}
                    onChange={(e) => update({ coding: { ...c.coding, difficulty: e.target.checked ? [...c.coding.difficulty, d] : c.coding.difficulty.filter((x) => x !== d) } })}
                  />
                  {d}
                </label>
              ))}
            </div>
            <Field label="Scheduling">
              <Select value={c.schedulingMode} onChange={(e) => update({ schedulingMode: e.target.value as DriveConfig["schedulingMode"] })}>
                <option value="staged">Staged — each round is a separate session, gated</option>
                <option value="single">Single sitting — all rounds back to back</option>
              </Select>
            </Field>
            <div>
              <p className="mb-1 text-sm font-medium">Interview languages</p>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
                {INTERVIEW_LANGUAGES.map((l) => {
                  const langs = c.languages ?? ["en"];
                  return (
                    <label key={l.code} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={langs.includes(l.code)}
                        disabled={l.code === "en" && langs.length === 1 && langs[0] === "en"}
                        onChange={(e) => {
                          const next = e.target.checked ? [...langs, l.code] : langs.filter((x) => x !== l.code);
                          update({ languages: next.length ? next : ["en"] });
                        }}
                      />
                      {l.label}
                    </label>
                  );
                })}
              </div>
              <p className="mt-1 text-xs text-slate-500">Candidates choose one in the round lobby. Voice mode uses the same language.</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={c.proctoring?.webcam ?? false}
                  onChange={(e) => update({ proctoring: { intervalSec: c.proctoring?.intervalSec ?? 90, webcam: e.target.checked } })}
                />
                <span>
                  <b>Webcam proctoring (opt-in)</b> — with the candidate&apos;s explicit consent, take a low-resolution snapshot every
                  <input
                    type="number"
                    min={30}
                    max={600}
                    className="mx-1 w-16 rounded border border-slate-300 px-1"
                    value={c.proctoring?.intervalSec ?? 90}
                    onChange={(e) => update({ proctoring: { webcam: c.proctoring?.webcam ?? false, intervalSec: Number(e.target.value) } })}
                  />
                  seconds and check that one person is present. Snapshots are context only (never scored), no face recognition is performed, and they are deleted with the candidate&apos;s data.
                </span>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Invite valid for (days)">
                <Input type="number" value={c.inviteExpiryDays} onChange={(e) => update({ inviteExpiryDays: Number(e.target.value) })} />
              </Field>
              <Field label="Next round valid for (days)">
                <Input type="number" value={c.nextRoundExpiryDays} onChange={(e) => update({ nextRoundExpiryDays: Number(e.target.value) })} />
              </Field>
            </div>
          </div>
          <div className="space-y-3">
            <p className="text-sm font-medium">Practical fit (HR round — shown as Match/Negotiable/Mismatch, never scored)</p>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Currency">
                <Input value={c.practicalFitBand.currency} onChange={(e) => update({ practicalFitBand: { ...c.practicalFitBand, currency: e.target.value } })} />
              </Field>
              <Field label="Budget min">
                <Input type="number" value={c.practicalFitBand.budgetMin ?? ""} onChange={(e) => update({ practicalFitBand: { ...c.practicalFitBand, budgetMin: e.target.value ? Number(e.target.value) : null } })} />
              </Field>
              <Field label="Budget max">
                <Input type="number" value={c.practicalFitBand.budgetMax ?? ""} onChange={(e) => update({ practicalFitBand: { ...c.practicalFitBand, budgetMax: e.target.value ? Number(e.target.value) : null } })} />
              </Field>
            </div>
            <p className="text-xs text-slate-500">Compensation is only asked if enabled in Settings (off by default).</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Max notice period (days)">
                <Input type="number" value={c.practicalFitBand.maxNoticeDays ?? ""} onChange={(e) => update({ practicalFitBand: { ...c.practicalFitBand, maxNoticeDays: e.target.value ? Number(e.target.value) : null } })} />
              </Field>
              <Field label="Locations (comma separated)">
                <Input value={c.practicalFitBand.locations.join(", ")} onChange={(e) => update({ practicalFitBand: { ...c.practicalFitBand, locations: list(e.target.value) } })} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-3 text-sm">
              <span className="text-slate-600">Work models:</span>
              {(["onsite", "hybrid", "remote"] as const).map((m) => (
                <label key={m} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={c.practicalFitBand.workModels.includes(m)}
                    onChange={(e) =>
                      update({ practicalFitBand: { ...c.practicalFitBand, workModels: e.target.checked ? [...c.practicalFitBand.workModels, m] : c.practicalFitBand.workModels.filter((x) => x !== m) } })
                    }
                  />
                  {m}
                </label>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <Button variant="secondary" onClick={save} disabled={!!busy}>
          {busy === "save" ? "Saving…" : "Save draft"}
        </Button>
        <Button onClick={publish} disabled={!!busy || issues.length > 0}>
          {busy === "publish" ? "Publishing…" : published ? "Publish new version" : "Publish & activate"}
        </Button>
        {issues.length > 0 && <span className="text-sm text-red-600">{issues[0].message}{issues.length > 1 ? ` (+${issues.length - 1} more)` : ""}</span>}
        {msg && <span className={cx("text-sm", msg.tone === "green" ? "text-emerald-700" : "text-red-600")}>{msg.text}</span>}
        {published && <span className="ml-auto text-xs text-slate-500">Publishing a new version applies to new candidates only; in-progress candidates keep their version.</span>}
      </div>
    </div>
  );
}
