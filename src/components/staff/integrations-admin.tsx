"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Input } from "../ui";
import { api } from "../api";
import { API_SCOPES, WEBHOOK_EVENTS } from "@/lib/integrations-shared";

interface KeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}
interface HookRow {
  id: string;
  url: string;
  events: string[];
  active: boolean;
}
interface DeliveryRow {
  id: string;
  url: string;
  event: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  error: string | null;
  createdAt: string;
}

const when = (s: string | null) => (s ? new Date(s).toLocaleString() : "—");
const toneFor = (s: string) => (s === "delivered" ? "green" : s === "failed" ? "red" : "amber");

/** One-time reveal of a newly created secret. */
function Reveal({ label, value, onClose }: { label: string; value: string; onClose: () => void }) {
  return (
    <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
      <p className="font-medium text-amber-900">{label} — copy it now; it won&apos;t be shown again.</p>
      <div className="mt-2 flex items-center gap-2">
        <code className="flex-1 break-all rounded bg-white px-2 py-1 font-mono text-xs">{value}</code>
        <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(value)}>
          Copy
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

export function IntegrationsAdmin({ keys, hooks, deliveries }: { keys: KeyRow[]; hooks: HookRow[]; deliveries: DeliveryRow[] }) {
  const router = useRouter();
  const [keyName, setKeyName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["drives:read", "candidates:read"]);
  const [newKey, setNewKey] = useState("");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["round.evaluated", "candidate.completed"]);
  const [newSecret, setNewSecret] = useState("");
  const [error, setError] = useState("");

  const run = async (fn: () => Promise<void>) => {
    setError("");
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const activeKeys = keys.filter((k) => !k.revokedAt);
  const revokedKeys = keys.filter((k) => k.revokedAt);
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <Card title="Integrations" actions={<span className="text-xs text-slate-500">Reference: docs/API.md</span>}>
      <section>
        <h3 className="text-sm font-semibold text-slate-800">API keys</h3>
        <p className="text-xs text-slate-500">For ATS/HRIS integrations calling <code>/api/v1</code> with <code>Authorization: Bearer hbe_…</code>. Only a hash is stored.</p>
        <table className="mt-2 w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="py-2">Name</th>
              <th>Key</th>
              <th>Scopes</th>
              <th>Last used</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {activeKeys.length === 0 && (
              <tr>
                <td colSpan={6} className="py-3 text-xs text-slate-500">
                  No active API keys.
                </td>
              </tr>
            )}
            {activeKeys.map((k) => (
              <tr key={k.id}>
                <td className="py-2">{k.name}</td>
                <td className="font-mono text-xs">{k.prefix}…</td>
                <td className="text-xs">{k.scopes.join(", ")}</td>
                <td className="text-xs">{when(k.lastUsedAt)}</td>
                <td>
                  <Badge tone={k.revokedAt ? "slate" : "green"}>{k.revokedAt ? "revoked" : "active"}</Badge>
                </td>
                <td className="text-right">
                  {!k.revokedAt && (
                    <Button variant="ghost" onClick={() => confirm(`Revoke key "${k.name}"? Integrations using it will stop working.`) && run(() => api(`/api/settings/api-keys/${k.id}`, { method: "DELETE" }))}>
                      Revoke
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {revokedKeys.length > 0 && (
          <details className="mt-2 text-xs text-slate-500">
            <summary className="cursor-pointer">{revokedKeys.length} revoked key(s)</summary>
            <ul className="mt-1 space-y-0.5">
              {revokedKeys.map((k) => (
                <li key={k.id}>
                  {k.name} · <span className="font-mono">{k.prefix}…</span> · revoked {when(k.revokedAt)}
                </li>
              ))}
            </ul>
          </details>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Input className="w-56" placeholder="Key name (e.g. Greenhouse sync)" value={keyName} onChange={(e) => setKeyName(e.target.value)} />
          {API_SCOPES.map((s) => (
            <label key={s} className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={scopes.includes(s)} onChange={() => setScopes(toggle(scopes, s))} />
              {s}
            </label>
          ))}
          <Button
            disabled={!keyName.trim() || scopes.length === 0}
            onClick={() =>
              run(async () => {
                const r = await api<{ key: string }>("/api/settings/api-keys", { body: { name: keyName, scopes } });
                setNewKey(r.key);
                setKeyName("");
              })
            }
          >
            Create key
          </Button>
        </div>
        {newKey && <Reveal label="New API key" value={newKey} onClose={() => setNewKey("")} />}
      </section>

      <section className="mt-6 border-t border-slate-100 pt-4">
        <h3 className="text-sm font-semibold text-slate-800">Webhooks</h3>
        <p className="text-xs text-slate-500">
          Events are POSTed as JSON, signed with <code>x-hbe-signature: sha256=HMAC(secret, timestamp + &quot;.&quot; + body)</code>. Failed deliveries retry with back-off.
        </p>
        <table className="mt-2 w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="py-2">URL</th>
              <th>Events</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {hooks.length === 0 && (
              <tr>
                <td colSpan={4} className="py-3 text-xs text-slate-500">
                  No webhooks yet.
                </td>
              </tr>
            )}
            {hooks.map((h) => (
              <tr key={h.id}>
                <td className="max-w-xs truncate py-2 font-mono text-xs" title={h.url}>
                  {h.url}
                </td>
                <td className="text-xs">{h.events.join(", ")}</td>
                <td>
                  <Badge tone={h.active ? "green" : "slate"}>{h.active ? "active" : "paused"}</Badge>
                </td>
                <td className="whitespace-nowrap text-right">
                  <Button variant="ghost" onClick={() => run(() => api(`/api/settings/webhooks/${h.id}/test`, { method: "POST" }))}>
                    Send test
                  </Button>
                  <Button variant="ghost" onClick={() => run(() => api(`/api/settings/webhooks/${h.id}`, { method: "PUT", body: { active: !h.active } }))}>
                    {h.active ? "Pause" : "Resume"}
                  </Button>
                  <Button variant="ghost" onClick={() => confirm("Delete this webhook and its delivery history?") && run(() => api(`/api/settings/webhooks/${h.id}`, { method: "DELETE" }))}>
                    Delete
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 space-y-2">
          <div className="flex gap-2">
            <Input placeholder="https://example.com/hooks/hbe" value={url} onChange={(e) => setUrl(e.target.value)} />
            <Button
              disabled={!url.trim() || events.length === 0}
              onClick={() =>
                run(async () => {
                  const r = await api<{ secret: string }>("/api/settings/webhooks", { body: { url, events } });
                  setNewSecret(r.secret);
                  setUrl("");
                })
              }
            >
              Add webhook
            </Button>
          </div>
          <div className="flex flex-wrap gap-3">
            {WEBHOOK_EVENTS.map((ev) => (
              <label key={ev} className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={events.includes(ev)} onChange={() => setEvents(toggle(events, ev))} />
                {ev}
              </label>
            ))}
          </div>
        </div>
        {newSecret && <Reveal label="Webhook signing secret" value={newSecret} onClose={() => setNewSecret("")} />}
        {deliveries.length > 0 && (
          <details className="mt-4" open>
            <summary className="cursor-pointer text-xs font-medium text-slate-600">Recent deliveries ({deliveries.length})</summary>
            <table className="mt-2 w-full text-xs">
              <thead className="text-left uppercase text-slate-500">
                <tr>
                  <th className="py-1">When</th>
                  <th>Event</th>
                  <th>Endpoint</th>
                  <th>Status</th>
                  <th>Attempts</th>
                  <th>Response</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {deliveries.map((d) => (
                  <tr key={d.id}>
                    <td className="py-1">{when(d.createdAt)}</td>
                    <td className="font-mono">{d.event}</td>
                    <td className="max-w-[16rem] truncate font-mono" title={d.url}>
                      {d.url}
                    </td>
                    <td>
                      <Badge tone={toneFor(d.status)}>{d.status}</Badge>
                    </td>
                    <td>{d.attempts}</td>
                    <td className="max-w-[14rem] truncate" title={d.error ?? ""}>
                      {d.responseStatus ?? "—"} {d.error && <span className="text-red-600">{d.error}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </section>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </Card>
  );
}
