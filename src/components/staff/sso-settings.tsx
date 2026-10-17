"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Field, Input, Select } from "../ui";
import { api } from "../api";

interface DomainRow {
  id: string;
  domain: string;
  txt: string;
  verified: boolean;
  verifiedBy: string | null;
}
interface Config {
  issuer: string;
  clientId: string;
  enabled: boolean;
  required: boolean;
  jitRole: "recruiter" | "hiring_manager" | "viewer" | null;
  lastTestedAt: string | null;
  hasSecret: boolean;
}

export function SsoSettings({ domains, config, redirectUri, testedEmail, error }: { domains: DomainRow[]; config: Config | null; redirectUri: string; testedEmail?: string; error?: string }) {
  const router = useRouter();
  const [domain, setDomain] = useState("");
  const [f, setF] = useState({
    issuer: config?.issuer ?? "",
    clientId: config?.clientId ?? "",
    clientSecret: "",
    enabled: config?.enabled ?? false,
    required: config?.required ?? false,
    jitRole: config?.jitRole ?? null,
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(error ? { ok: false, text: error } : testedEmail ? { ok: true, text: `Test sign-in worked: your identity provider confirmed ${testedEmail}.` } : null);
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg({ ok: true, text: ok });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };
  const anyVerified = domains.some((d) => d.verified);
  return (
    <Card title="Single sign-on" actions={<Badge tone={config?.enabled ? "green" : "slate"}>{config?.enabled ? (config.required ? "required" : "on") : "off"}</Badge>}>
      <div id="sso" className="space-y-6 text-sm">
        <section>
          <h3 className="font-semibold text-slate-800">1. Email domains</h3>
          <p className="text-slate-600">People sign in with SSO by entering their work email; we route them to your identity provider by its domain. Prove you control a domain with a DNS TXT record.</p>
          <ul className="mt-2 divide-y divide-slate-100">
            {domains.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <span className="font-medium">{d.domain}</span> {d.verified ? <Badge tone="green">verified{d.verifiedBy === "platform" ? " by platform" : ""}</Badge> : <Badge tone="amber">not verified</Badge>}
                  {!d.verified && (
                    <p className="mt-1 text-xs text-slate-600">
                      Add a TXT record on <b>{d.domain}</b> with the value <code className="rounded bg-slate-100 px-1 font-mono">{d.txt}</code>, then click Verify.
                    </p>
                  )}
                </div>
                <div className="flex gap-1">
                  {!d.verified && (
                    <Button variant="secondary" onClick={() => run(() => api(`/api/settings/domains/${d.id}/verify`, { method: "POST" }), `${d.domain} verified.`)}>
                      Verify
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => confirm(`Remove ${d.domain}? People with this email domain can no longer use SSO.`) && run(() => api(`/api/settings/domains/${d.id}`, { method: "DELETE" }))}>
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <Input aria-label="Email domain" placeholder="example.com" className="max-w-xs" value={domain} onChange={(e) => setDomain(e.target.value)} />
            <Button variant="secondary" disabled={!domain.trim()} onClick={() => run(async () => (await api("/api/settings/domains", { body: { domain } }), setDomain("")))}>
              Add domain
            </Button>
          </div>
        </section>

        <section className="border-t border-slate-100 pt-4">
          <h3 className="font-semibold text-slate-800">2. Identity provider (OpenID Connect)</h3>
          <p className="text-slate-600">
            Create an app in Google Workspace, Microsoft Entra ID, Okta or any OpenID Connect provider with this redirect URI:{" "}
            <code className="break-all rounded bg-slate-100 px-1 font-mono text-xs">{redirectUri}</code>. For Microsoft, use the tenant-specific issuer (https://login.microsoftonline.com/&lt;tenant-id&gt;/v2.0).
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <Field label="Issuer URL">
              <Input placeholder="https://accounts.google.com" value={f.issuer} onChange={(e) => setF({ ...f, issuer: e.target.value })} />
            </Field>
            <Field label="Client ID">
              <Input value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })} />
            </Field>
            <Field label="Client secret" hint={config?.hasSecret ? "Stored encrypted. Leave blank to keep it." : "Stored encrypted; never shown again."}>
              <Input type="password" autoComplete="off" value={f.clientSecret} placeholder={config?.hasSecret ? "••••••••" : ""} onChange={(e) => setF({ ...f, clientSecret: e.target.value })} />
            </Field>
          </div>
          <div className="mt-3 space-y-2">
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={f.enabled} disabled={!anyVerified} onChange={(e) => setF({ ...f, enabled: e.target.checked, required: e.target.checked && f.required })} />
              <span>Turn on single sign-on{!anyVerified && <span className="text-slate-600"> (verify a domain first)</span>}</span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={f.required} disabled={!f.enabled} onChange={(e) => setF({ ...f, required: e.target.checked })} />
              <span>
                <b>Require</b> single sign-on — passwords stop working for this organisation&apos;s staff (platform administrators keep password access for emergencies). Your identity provider becomes responsible for multi-factor authentication.
              </span>
            </label>
            <Field label="New people from your verified domains">
              <Select className="max-w-md" value={f.jitRole ?? ""} onChange={(e) => setF({ ...f, jitRole: (e.target.value || null) as Config["jitRole"] })}>
                <option value="">Must be added by an admin first</option>
                <option value="viewer">Get an account automatically as Viewer</option>
                <option value="hiring_manager">Get an account automatically as Hiring manager</option>
                <option value="recruiter">Get an account automatically as Recruiter</option>
              </Select>
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              disabled={!f.issuer || !f.clientId}
              onClick={() => run(() => api("/api/settings/sso", { method: "PUT", body: { ...f, clientSecret: f.clientSecret || undefined } }), "Single sign-on settings saved.")}
            >
              Save
            </Button>
            {config && (
              <a href="/api/auth/sso/start?test=1" className="rounded-lg bg-white px-3.5 py-2 font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
                Test sign-in
              </a>
            )}
            {config?.lastTestedAt && <span className="text-xs text-slate-600">Last successful test {new Date(config.lastTestedAt).toLocaleString()}</span>}
          </div>
        </section>
        {msg && (
          <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-emerald-700" : "text-red-700"}>
            {msg.text}
          </p>
        )}
      </div>
    </Card>
  );
}
