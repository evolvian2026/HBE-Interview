"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Select } from "../ui";
import { api } from "../api";

/** Recruiter tags on a person (comma-separated). */
export function TagEditor({ candidateId, initial }: { candidateId: string; initial: string[] }) {
  const router = useRouter();
  const [text, setText] = useState(initial.join(", "));
  const [msg, setMsg] = useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-2 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        setMsg("");
        try {
          const r = await api<{ tags: string[] }>(`/api/talent/${candidateId}/tags`, { method: "PUT", body: { tags: text.split(",") } });
          setText(r.tags.join(", "));
          setMsg("Saved.");
          router.refresh();
        } catch (err) {
          setMsg((err as Error).message);
        }
      }}
    >
      <label className="block min-w-72 flex-1">
        <span className="mb-1 block text-xs font-medium text-slate-700">Tags (comma-separated)</span>
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="silver medalist, payments, backend" />
      </label>
      <Button type="submit" variant="secondary">
        Save tags
      </Button>
      {msg && (
        <span role="status" className="text-slate-600">
          {msg}
        </span>
      )}
    </form>
  );
}

/** Invite a pooled candidate to another active drive. */
export function ReinviteForm({ candidateId, drives }: { candidateId: string; drives: { id: string; title: string }[] }) {
  const router = useRouter();
  const [driveId, setDriveId] = useState(drives[0]?.id ?? "");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  if (!drives.length) return <p className="text-sm text-slate-600">No other active hiring drives to invite them to.</p>;
  return (
    <div className="flex flex-wrap items-end gap-2 text-sm">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-700">Hiring drive</span>
        <Select value={driveId} onChange={(e) => setDriveId(e.target.value)}>
          {drives.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </Select>
      </label>
      <Button
        disabled={busy || !driveId}
        onClick={async () => {
          setMsg("");
          setBusy(true);
          try {
            const r = await api<{ resumeReused: boolean }>(`/api/talent/${candidateId}/invite`, { body: { driveId } });
            setMsg(r.resumeReused ? "Invited. Their resume is being matched to the new role, so they won't need to upload it again." : "Invited.");
            router.refresh();
          } catch (e) {
            setMsg((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Invite to this drive
      </Button>
      {msg && (
        <span role="status" className="text-slate-700">
          {msg}
        </span>
      )}
    </div>
  );
}
