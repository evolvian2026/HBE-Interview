"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Select } from "../ui";
import { api } from "../api";

interface Row {
  projectName: string;
  url: string;
  mode: "url" | "none";
  reason: string;
}

export function ProjectsStep({ token, projects, githubUsername, links }: { token: string; projects: string[]; githubUsername: string; links: Record<string, string> }) {
  const router = useRouter();
  const [user, setUser] = useState(githubUsername);
  const [rows, setRows] = useState<Row[]>(projects.map((p) => ({ projectName: p, url: links[p] ?? "", mode: "url", reason: "" })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function save() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/c/${token}/repos`, {
        body: {
          githubUsername: user.trim(),
          projects: rows.map((r) => ({ projectName: r.projectName, url: r.mode === "url" ? r.url.trim() || null : null, notPublicReason: r.mode === "none" ? r.reason || "Not public" : r.url.trim() ? null : "No link provided" })),
        },
      });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Link your projects on GitHub</h2>
        <p className="text-sm text-slate-600">
          The AI looks at the code of your <b>public</b> repositories and asks you about it — what you built and why. If a project isn&apos;t on GitHub, tell us why; that&apos;s fine.
        </p>
      </div>
      <Field label="Your GitHub username" hint="Used to identify your commits.">
        <Input value={user} onChange={(e) => setUser(e.target.value)} placeholder="octocat" className="max-w-xs" />
      </Field>
      {rows.length === 0 && <p className="text-sm text-slate-500">No projects were listed on your profile. You can continue without linking a repository.</p>}
      {rows.map((r, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-slate-200 p-4">
          <p className="text-sm font-medium">{r.projectName}</p>
          <div className="flex flex-wrap gap-2">
            <Select value={r.mode} onChange={(e) => update(i, { mode: e.target.value as Row["mode"] })} className="max-w-56">
              <option value="url">Public GitHub repository</option>
              <option value="none">Not on GitHub / private</option>
            </Select>
            {r.mode === "url" ? (
              <Input className="min-w-64 flex-1" placeholder="https://github.com/owner/repo" value={r.url} onChange={(e) => update(i, { url: e.target.value })} />
            ) : (
              <Select className="min-w-64 flex-1" value={r.reason} onChange={(e) => update(i, { reason: e.target.value })}>
                <option value="">Choose a reason</option>
                <option>Proprietary / employer code</option>
                <option>Private repository</option>
                <option>Code no longer available</option>
                <option>Not a code project</option>
              </Select>
            )}
          </div>
        </div>
      ))}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button onClick={save} disabled={busy}>
        {busy ? "Saving…" : "Save and continue"}
      </Button>
    </div>
  );
}
