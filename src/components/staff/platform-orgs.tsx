"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Field, Input } from "../ui";
import { api } from "../api";

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended";
  aiBudgetUsd: number | null;
  users: number;
  drives: number;
  candidates: number;
  rounds30: number;
  cost30: number;
  costMonth: number;
  createdAt: string;
}

const usd = (x: number) => (x < 1 ? `$${x.toFixed(3)}` : `$${x.toFixed(2)}`);

export function PlatformOrgs({ orgs, activeOrgId, homeOrgId }: { orgs: OrgRow[]; activeOrgId: string; homeOrgId: string }) {
  const router = useRouter();
  const [f, setF] = useState({ name: "", slug: "", adminName: "", adminEmail: "", adminPassword: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setError("");
    setBusy(true);
    try {
      await fn();
      after?.();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const enter = (id: string) => run(() => api("/api/platform/switch", { body: { orgId: id } }), () => router.push("/app"));
  return (
    <div className="space-y-6">
      <Card title={`Organisations (${orgs.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2">Organisation</th>
                <th>Status</th>
                <th className="text-right">Users</th>
                <th className="text-right">Drives</th>
                <th className="text-right">Candidates</th>
                <th className="text-right">Rounds (30 d)</th>
                <th className="text-right">AI cost (30 d)</th>
                <th className="text-right">This month / budget</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {orgs.map((o) => {
                const over = o.aiBudgetUsd != null && o.costMonth > o.aiBudgetUsd;
                return (
                  <tr key={o.id}>
                    <td className="py-2">
                      <p className="font-medium">
                        {o.name} {o.id === activeOrgId && <Badge tone="blue">viewing</Badge>} {o.id === homeOrgId && <Badge>home</Badge>}
                      </p>
                      <p className="font-mono text-xs text-slate-500">{o.slug}</p>
                    </td>
                    <td>
                      <Badge tone={o.status === "active" ? "green" : "red"}>{o.status}</Badge>
                    </td>
                    <td className="text-right">{o.users}</td>
                    <td className="text-right">{o.drives}</td>
                    <td className="text-right">{o.candidates}</td>
                    <td className="text-right">{o.rounds30}</td>
                    <td className="text-right">{usd(o.cost30)}</td>
                    <td className="text-right">
                      <span className={over ? "font-semibold text-red-700" : ""}>{usd(o.costMonth)}</span>
                      <span className="text-slate-500"> / </span>
                      <button
                        className="text-brand-700 underline decoration-dotted"
                        title="Set monthly AI budget alert"
                        onClick={() => {
                          const v = prompt(`Monthly AI budget alert for ${o.name} in USD (empty = none)`, o.aiBudgetUsd?.toString() ?? "");
                          if (v === null) return;
                          const n = v.trim() === "" ? null : Number(v);
                          if (n !== null && (!Number.isFinite(n) || n < 0)) return alert("Enter a number");
                          run(() => api(`/api/platform/orgs/${o.id}`, { method: "PUT", body: { aiBudgetUsd: n } }));
                        }}
                      >
                        {o.aiBudgetUsd == null ? "none" : usd(o.aiBudgetUsd)}
                      </button>
                    </td>
                    <td className="whitespace-nowrap text-right">
                      {o.id !== activeOrgId && (
                        <Button variant="secondary" disabled={busy} onClick={() => enter(o.id)}>
                          {o.id === homeOrgId ? "Return home" : "Enter"}
                        </Button>
                      )}
                      {o.id !== homeOrgId && (
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            (o.status === "active" ? confirm(`Suspend ${o.name}? Its users can't sign in and its API keys stop working. Candidate links keep working.`) : true) &&
                            run(() => api(`/api/platform/orgs/${o.id}`, { method: "PUT", body: { status: o.status === "active" ? "suspended" : "active" } }))
                          }
                        >
                          {o.status === "active" ? "Suspend" : "Reactivate"}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">Costs are estimates from recorded token usage at list prices (mock-mode calls aren&apos;t recorded). The budget is an alert threshold shown to the organisation&apos;s admins — interviews are never interrupted.</p>
      </Card>

      <Card title="New organisation">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Organisation name">
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Acme Corp" />
          </Field>
          <Field label="Slug (optional)" hint="Lower-case identifier; generated from the name if empty">
            <Input value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} placeholder="acme" />
          </Field>
          <Field label="First admin — name">
            <Input value={f.adminName} onChange={(e) => setF({ ...f, adminName: e.target.value })} />
          </Field>
          <Field label="First admin — email">
            <Input type="email" value={f.adminEmail} onChange={(e) => setF({ ...f, adminEmail: e.target.value })} />
          </Field>
          <Field label="First admin — temporary password (10+)">
            <Input type="password" value={f.adminPassword} onChange={(e) => setF({ ...f, adminPassword: e.target.value })} />
          </Field>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button
            disabled={busy || !f.name.trim() || !f.adminEmail.trim() || f.adminPassword.length < 10 || !f.adminName.trim()}
            onClick={() =>
              run(
                () => api("/api/platform/orgs", { body: { name: f.name, slug: f.slug || undefined, admin: { name: f.adminName, email: f.adminEmail, password: f.adminPassword } } }),
                () => setF({ name: "", slug: "", adminName: "", adminEmail: "", adminPassword: "" }),
              )
            }
          >
            Create organisation
          </Button>
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </Card>
    </div>
  );
}
