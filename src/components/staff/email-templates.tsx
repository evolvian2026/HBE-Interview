"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Input, Select, Textarea } from "../ui";
import { api } from "../api";

export interface TemplateRow {
  key: string;
  label: string;
  when: string;
  placeholders: { name: string; description: string }[];
  required: string[];
  subject: string;
  body: string;
  defaultSubject: string;
  defaultBody: string;
  custom: boolean;
}

/** Admins edit candidate emails with a live, branded preview. */
export function EmailTemplates({ rows }: { rows: TemplateRow[] }) {
  const router = useRouter();
  const [key, setKey] = useState(rows[0]?.key ?? "");
  const row = rows.find((r) => r.key === key)!;
  const [subject, setSubject] = useState(row.subject);
  const [body, setBody] = useState(row.body);
  const [preview, setPreview] = useState<{ subject: string; html: string; problems: string[] } | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setSubject(row.subject);
    setBody(row.body);
    setMsg("");
  }, [row]);

  useEffect(() => {
    const t = setTimeout(() => {
      api<{ subject: string; html: string; problems: string[] }>("/api/settings/emails/preview", { body: { key, subject, body } })
        .then(setPreview)
        .catch(() => undefined);
    }, 300);
    return () => clearTimeout(t);
  }, [key, subject, body]);

  const insert = (name: string) => {
    const el = bodyRef.current;
    const token = `{{${name}}}`;
    if (!el) return setBody((b) => `${b}${token}`);
    const [a, b] = [el.selectionStart, el.selectionEnd];
    setBody(body.slice(0, a) + token + body.slice(b));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + token.length, a + token.length);
    });
  };
  const dirty = subject !== row.subject || body !== row.body;
  async function run(fn: () => Promise<string>) {
    setMsg("");
    setBusy(true);
    try {
      setMsg(await fn());
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-3 text-sm">
        <label className="block">
          <span className="mb-1 block font-medium text-slate-700">Email</span>
          <Select value={key} onChange={(e) => setKey(e.target.value)}>
            {rows.map((r) => (
              <option key={r.key} value={r.key}>
                {`${r.label}${r.custom ? " (customised)" : ""}`}
              </option>
            ))}
          </Select>
          <span className="mt-1 block text-xs text-slate-600">{`Sent when: ${row.when}`}</span>
        </label>
        <label className="block">
          <span className="mb-1 block font-medium text-slate-700">Subject</span>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
        </label>
        <label className="block">
          <span className="mb-1 block font-medium text-slate-700">Message</span>
          <Textarea ref={bodyRef} rows={11} value={body} onChange={(e) => setBody(e.target.value)} className="font-mono text-xs" />
          <span className="mt-1 block text-xs text-slate-600">A blank line starts a new paragraph. A paragraph that is just {"{{link}}"} becomes a button.</span>
        </label>
        <div>
          <p className="mb-1 text-xs font-medium text-slate-700">Insert a placeholder</p>
          <div className="flex flex-wrap gap-1.5">
            {row.placeholders.map((p) => (
              <button key={p.name} type="button" title={p.description} onClick={() => insert(p.name)} className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-700 hover:bg-slate-200">
                {`{{${p.name}}}`}
                {row.required.includes(p.name) && " *"}
              </button>
            ))}
          </div>
          {row.required.length > 0 && <p className="mt-1 text-xs text-slate-600">* must appear in this email</p>}
        </div>
        {preview && preview.problems.length > 0 && (
          <ul role="alert" className="list-disc rounded-lg bg-red-50 p-2 pl-6 text-red-800">
            {preview.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={busy || !dirty || !!preview?.problems.length} onClick={() => run(async () => (await api(`/api/settings/emails/${key}`, { method: "PUT", body: { subject, body } }), "Saved."))}>
            Save
          </Button>
          <Button variant="secondary" disabled={busy || dirty} title={dirty ? "Save first" : undefined} onClick={() => run(async () => ((await api<{ sent: boolean; to: string }>(`/api/settings/emails/${key}/test`, { body: {} })).sent ? "Test sent to your email." : "Email sending isn't configured (RESEND_API_KEY), so nothing was sent."))}>
            Send me a test
          </Button>
          {row.custom && (
            <Button variant="ghost" disabled={busy} onClick={() => confirm("Go back to the built-in text for this email?") && run(async () => (await api(`/api/settings/emails/${key}`, { method: "DELETE" }), "Back to the built-in text."))}>
              Reset to default
            </Button>
          )}
          {row.custom ? <Badge tone="blue">customised</Badge> : <Badge>built-in</Badge>}
          {msg && (
            <span role="status" className="text-slate-700">
              {msg}
            </span>
          )}
        </div>
      </div>
      <div className="text-sm">
        <p className="mb-1 font-medium text-slate-700">Preview (example values, your branding)</p>
        <p className="mb-2 rounded-lg bg-slate-50 px-3 py-2">
          <span className="text-xs text-slate-500">Subject: </span>
          {preview?.subject ?? "…"}
        </p>
        <iframe title="Email preview" sandbox="" srcDoc={preview?.html ?? ""} className="h-[28rem] w-full rounded-lg border border-slate-200 bg-white" />
      </div>
    </div>
  );
}
