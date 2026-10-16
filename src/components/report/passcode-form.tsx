"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input } from "../ui";
import { api } from "../api";

export function PasscodeForm({ token }: { token: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        try {
          await api(`/api/r/${token}/unlock`, { body: { passcode: code } });
          router.refresh();
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <p className="text-sm text-slate-600">This report is protected. Enter the passcode you were given.</p>
      <Field label="Passcode">
        <Input type="password" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={!code}>
        View report
      </Button>
    </form>
  );
}
