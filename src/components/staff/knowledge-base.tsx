"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input, Textarea } from "../ui";
import { api } from "../api";

export function KnowledgeBase({ docs }: { docs: { id: string; title: string; size: number; preview: string }[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <Card title="HR knowledge base (policy Q&A)">
      <p className="mb-3 text-sm text-slate-600">
        In the HR round, the AI answers candidates&apos; questions about policies (leave, benefits, work model, probation…) <b>only</b> from these documents and cites them. Anything else is logged for HR to follow up.
        <span className="mt-1 block text-xs text-slate-500">
          Up to ~60,000 characters in total are given to the interviewer whole. Larger knowledge bases are searched instead: each candidate question retrieves the five most relevant passages.
          {docs.reduce((n, d) => n + d.size, 0) > 60_000 && <b className="text-slate-700"> Your knowledge base is in search mode.</b>}
        </span>
      </p>
      <ul className="mb-4 divide-y divide-slate-100 text-sm">
        {docs.map((d) => (
          <li key={d.id} className="flex items-start justify-between gap-3 py-2">
            <div>
              <p className="font-medium">{d.title}</p>
              <p className="text-xs text-slate-500">
                {d.size < 1000 ? `${d.size} chars` : `${Math.round(d.size / 1000)}k chars`} · {d.preview}…
              </p>
            </div>
            <Button
              variant="ghost"
              onClick={async () => {
                if (!confirm(`Delete "${d.title}"?`)) return;
                await api(`/api/settings/kb/${d.id}`, { method: "DELETE" });
                router.refresh();
              }}
            >
              Delete
            </Button>
          </li>
        ))}
        {docs.length === 0 && <li className="py-2 text-slate-500">No documents yet — the AI will defer all policy questions to HR.</li>}
      </ul>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <Field label="Title">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Leave Policy 2026" />
          </Field>
          <Field label="Content (paste text or FAQ)">
            <Textarea rows={5} value={content} onChange={(e) => setContent(e.target.value)} />
          </Field>
          <Button
            variant="secondary"
            disabled={!title.trim() || !content.trim()}
            onClick={async () => {
              try {
                await api("/api/settings/kb", { body: { title, content } });
                setTitle("");
                setContent("");
                router.refresh();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Add document
          </Button>
        </div>
        <div className="rounded-lg border-2 border-dashed border-slate-300 p-4 text-center text-sm text-slate-600">
          <p>Or upload a PDF, DOCX, TXT or MD file</p>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,.txt,.md"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const form = new FormData();
              form.append("file", f);
              try {
                await api("/api/settings/kb", { form });
                router.refresh();
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          />
          <Button variant="secondary" className="mt-2" onClick={() => fileRef.current?.click()}>
            Upload file
          </Button>
        </div>
      </div>
      {docs.length > 0 && <KbSearchPreview />}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </Card>
  );
}

/** Lets admins check which passages a candidate question would retrieve (used when the KB is in search mode). */
function KbSearchPreview() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ title: string; content: string; rank: number }[] | null>(null);
  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <p className="text-sm font-medium">Try a candidate question</p>
      <div className="mt-2 flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. How many days of annual leave do I get?" />
        <Button
          variant="secondary"
          disabled={!q.trim()}
          onClick={async () => setHits((await api<{ passages: { title: string; content: string; rank: number }[] }>(`/api/settings/kb/search?q=${encodeURIComponent(q)}`)).passages)}
        >
          Search
        </Button>
      </div>
      {hits && (
        <ol className="mt-2 space-y-2 text-sm">
          {hits.length === 0 && <li className="text-slate-500">No matching passages — the interviewer would say HR will follow up.</li>}
          {hits.map((h, i) => (
            <li key={i} className="rounded-lg bg-slate-50 p-2">
              <p className="text-xs font-medium text-slate-500">
                {h.title} · relevance {h.rank}
              </p>
              <p className="whitespace-pre-wrap">{h.content}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
