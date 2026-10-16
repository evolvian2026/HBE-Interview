"use client";

import { useState } from "react";
import { Button, Select } from "../ui";

const LANGS = ["python", "javascript", "typescript", "java", "cpp", "sql", "go", "bash", "text"];

/** Inline mini-editor for writing a code/SQL snippet into a chat answer (F-8). */
export function SnippetEditor({ onInsert, onClose }: { onInsert: (fenced: string) => void; onClose: () => void }) {
  const [lang, setLang] = useState("python");
  const [code, setCode] = useState("");
  return (
    <div className="mb-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
      <div className="mb-1 flex items-center gap-2 text-xs">
        <span className="font-medium text-slate-600">Code snippet</span>
        <Select className="w-36 py-1 text-xs" value={lang} onChange={(e) => setLang(e.target.value)}>
          {LANGS.map((l) => (
            <option key={l}>{l}</option>
          ))}
        </Select>
        <button className="ml-auto text-slate-500 hover:text-slate-800" onClick={onClose}>
          Close
        </button>
      </div>
      <textarea
        className="block h-36 w-full rounded border border-slate-300 bg-slate-900 p-2 font-mono text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-brand-500"
        spellCheck={false}
        value={code}
        placeholder="Write your snippet here…"
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Tab") {
            e.preventDefault();
            const t = e.currentTarget;
            const s = t.selectionStart;
            const v = code.slice(0, s) + "    " + code.slice(t.selectionEnd);
            setCode(v);
            requestAnimationFrame(() => (t.selectionStart = t.selectionEnd = s + 4));
          }
        }}
      />
      <Button
        variant="secondary"
        className="mt-1 px-2 py-1 text-xs"
        disabled={!code.trim()}
        onClick={() => {
          onInsert(`\n\`\`\`${lang}\n${code.replace(/```/g, "ʼʼʼ")}\n\`\`\`\n`);
          setCode("");
          onClose();
        }}
      >
        Insert into answer
      </Button>
    </div>
  );
}
