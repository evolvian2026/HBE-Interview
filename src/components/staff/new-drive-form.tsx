"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input, Textarea } from "../ui";
import { api } from "../api";

export function NewDriveForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [jd, setJd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Card>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const { id } = await api<{ id: string }>("/api/drives", { body: { title, jdText: jd } });
            router.push(`/app/drives/${id}/edit`);
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        <Field label="Role title">
          <Input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Senior Backend Engineer – Node.js" />
        </Field>
        <Field label="Job description" hint={`${jd.length} characters (minimum 200). Include responsibilities, required skills and experience.`}>
          <Textarea required rows={16} value={jd} onChange={(e) => setJd(e.target.value)} />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" disabled={busy || jd.trim().length < 200 || !title.trim()}>
          {busy ? "Analysing the JD…" : "Analyse and continue"}
        </Button>
      </form>
    </Card>
  );
}
