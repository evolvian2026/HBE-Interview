"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Select } from "../ui";
import { api } from "../api";
import { CopyButton } from "./copy-button";

export interface ScimView {
  configured: boolean;
  enabled: boolean;
  defaultRole: "recruiter" | "hiring_manager" | "viewer";
  tokenPrefix: string | null;
  lastUsedAt: string | null;
  provisioned: number;
  active: number;
  verifiedDomains: number;
}

const ROLE_LABEL = { recruiter: "Recruiter", hiring_manager: "Hiring manager", viewer: "Viewer" } as const;

/** SCIM 2.0: the identity provider creates, updates and deactivates staff accounts. */
export function ScimSettings({ baseUrl, s }: { baseUrl: string; s: ScimView }) {
  const router = useRouter();
  const [role, setRole] = useState(s.defaultRole);
  const [token, setToken] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<string | void>) {
    setMsg("");
    setBusy(true);
    try {
      const r = await fn();
      if (r) setMsg(r);
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4 text-sm">
      <p className="text-slate-600">
        Let Okta, Microsoft Entra ID or another identity provider manage staff accounts: people assigned to the app are created, updated and deactivated automatically, and their role follows the group they&apos;re in (<b>HBE Admins</b>, <b>HBE Recruiters</b>, <b>HBE Hiring Managers</b>, <b>HBE Viewers</b>). Only emails on your verified domains can be provisioned; platform administrators are never touched.
      </p>
      {s.verifiedDomains === 0 && <p className="rounded-lg bg-amber-50 p-2 text-amber-900">Verify an email domain above first — provisioning only accepts addresses on verified domains.</p>}
      <dl className="grid gap-2 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium text-slate-600">SCIM base URL</dt>
          <dd className="flex items-center gap-2 font-mono text-xs">
            {baseUrl} <CopyButton text={baseUrl} label="Copy URL" />
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-slate-600">Status</dt>
          <dd>
            {s.configured ? (
              <>
                <Badge tone={s.enabled ? "green" : "amber"}>{s.enabled ? "on" : "paused"}</Badge> {`token ${s.tokenPrefix}… · ${s.lastUsedAt ? `last used ${new Date(s.lastUsedAt).toLocaleString()}` : "not used yet"} · ${s.active} active of ${s.provisioned} provisioned`}
              </>
            ) : (
              <Badge>not set up</Badge>
            )}
          </dd>
        </div>
      </dl>
      <label className="block max-w-xs">
        <span className="mb-1 block text-xs font-medium text-slate-700">Role for new people (until a group assigns one)</span>
        <Select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
          {(Object.keys(ROLE_LABEL) as (keyof typeof ROLE_LABEL)[]).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </Select>
      </label>
      {token && (
        <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <p className="font-medium text-emerald-900">Copy this token into your identity provider now — it won&apos;t be shown again.</p>
          <p className="mt-1 flex items-center gap-2 break-all font-mono text-xs">
            {token} <CopyButton text={token} label="Copy token" />
          </p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy}
          onClick={() =>
            (!s.configured || confirm("Create a new token? The current one stops working immediately.")) &&
            run(async () => {
              const r = await api<{ token: string }>("/api/settings/scim", { body: { defaultRole: role } });
              setToken(r.token);
            })
          }
        >
          {s.configured ? "Rotate token" : "Turn on provisioning"}
        </Button>
        {s.configured && role !== s.defaultRole && (
          <Button variant="secondary" disabled={busy} onClick={() => run(async () => (await api("/api/settings/scim", { method: "PATCH", body: { defaultRole: role } }), "Saved."))}>
            Save default role
          </Button>
        )}
        {s.configured && (
          <Button variant="ghost" disabled={busy} onClick={() => run(async () => (await api("/api/settings/scim", { method: "PATCH", body: { enabled: !s.enabled } }), s.enabled ? "Provisioning paused." : "Provisioning resumed."))}>
            {s.enabled ? "Pause" : "Resume"}
          </Button>
        )}
      </div>
      {msg && (
        <p role="status" className="text-slate-700">
          {msg}
        </p>
      )}
    </div>
  );
}
