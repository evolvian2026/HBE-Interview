"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Input, Select } from "../ui";
import { api } from "../api";

export interface ChannelView {
  id: string;
  kind: "slack" | "teams";
  name: string;
  host: string;
  events: string[];
  includeNames: boolean;
  active: boolean;
  lastDeliveredAt: string | null;
  lastError: string | null;
}

/** Slack / Teams incoming webhooks for team notifications (admins). */
export function NotificationChannels({ channels, events }: { channels: ChannelView[]; events: { key: string; label: string }[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<"slack" | "teams">("slack");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [chosen, setChosen] = useState<string[]>(["decision.needed", "panel.feedback_complete", "candidate.decided"]);
  const [names, setNames] = useState(false);
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
    <div className="space-y-5 text-sm">
      <p className="text-slate-600">Post updates to a Slack or Microsoft Teams channel using an incoming webhook URL from that app. Messages link back here; candidate names are left out unless you turn them on for a channel.</p>
      {channels.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {channels.map((c) => (
            <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="font-medium">
                  {c.name} <Badge>{c.kind === "slack" ? "Slack" : "Teams"}</Badge> {!c.active && <Badge tone="amber">paused</Badge>} {c.includeNames && <Badge tone="blue">includes names</Badge>}
                </p>
                <p className="text-xs text-slate-600">{`${c.host} · ${c.events.length} event${c.events.length === 1 ? "" : "s"}`}</p>
                <p className="text-xs text-slate-500">
                  {c.lastError ? <span className="text-red-700">{`Last error: ${c.lastError}`}</span> : c.lastDeliveredAt ? `Last delivered ${new Date(c.lastDeliveredAt).toLocaleString()}` : "Nothing sent yet"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" disabled={busy} onClick={() => run(async () => ((await api<{ ok: boolean; error?: string }>(`/api/settings/channels/${c.id}/test`, { body: {} })).ok ? `Test sent to ${c.name}.` : `Test failed for ${c.name}.`))}>
                  Send test
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => run(() => api(`/api/settings/channels/${c.id}`, { method: "PATCH", body: { active: !c.active } }).then(() => undefined))}>
                  {c.active ? "Pause" : "Resume"}
                </Button>
                <Button variant="ghost" className="text-red-700" disabled={busy} onClick={() => confirm(`Remove ${c.name}?`) && run(() => api(`/api/settings/channels/${c.id}`, { method: "DELETE" }).then(() => undefined))}>
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form
        className="space-y-3 rounded-lg border border-slate-200 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await api("/api/settings/channels", { body: { kind, name, url, events: chosen, includeNames: names } });
            setName("");
            setUrl("");
            return "Channel added. Send a test to check it.";
          });
        }}
      >
        <p className="font-medium">Add a channel</p>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">App</span>
            <Select value={kind} onChange={(e) => setKind(e.target.value as "slack" | "teams")}>
              <option value="slack">Slack</option>
              <option value="teams">Microsoft Teams</option>
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="#hiring-backend" required maxLength={80} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">Incoming webhook URL</span>
            <Input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={kind === "slack" ? "https://hooks.slack.com/services/…" : "https://….webhook.office.com/…"} required />
          </label>
        </div>
        <fieldset>
          <legend className="mb-1 text-xs font-medium text-slate-700">Send a message when</legend>
          <div className="grid gap-1 md:grid-cols-2">
            {events.map((ev) => (
              <label key={ev.key} className="flex items-center gap-2">
                <input type="checkbox" checked={chosen.includes(ev.key)} onChange={(e) => setChosen(e.target.checked ? [...chosen, ev.key] : chosen.filter((x) => x !== ev.key))} />
                {ev.label}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1" checked={names} onChange={(e) => setNames(e.target.checked)} />
          <span>Include candidate names (only for private channels limited to the hiring team)</span>
        </label>
        <Button type="submit" disabled={busy || !chosen.length}>
          Add channel
        </Button>
      </form>
      {msg && (
        <p role="status" className="text-slate-700">
          {msg}
        </p>
      )}
    </div>
  );
}
