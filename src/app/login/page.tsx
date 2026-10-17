"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input, Logo } from "@/components/ui";
import { api } from "@/components/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"password" | "code">("password");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (step === "password") {
        const r = await api<{ ok?: boolean; twoFactor?: boolean }>("/api/auth/login", { body: { email, password } });
        if (r.twoFactor) {
          setStep("code");
          return;
        }
      } else {
        const r = await api<{ recoveryCodesLeft?: number }>("/api/auth/2fa", { body: { code } });
        if (r.recoveryCodesLeft !== undefined && r.recoveryCodesLeft <= 2) alert(`You have ${r.recoveryCodesLeft} recovery code(s) left. Generate new ones under Security.`);
      }
      router.push("/app");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      if (step === "code" && /expired/i.test((err as Error).message)) setStep("password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <Card>
          <form onSubmit={submit} className="space-y-4">
            <h1 className="text-lg font-semibold">{step === "password" ? "Sign in" : "Two-factor sign-in"}</h1>
            {step === "password" ? (
              <>
                <Field label="Email">
                  <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </Field>
                <Field label="Password">
                  <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                </Field>
              </>
            ) : (
              <Field label="6-digit code from your authenticator app" hint="Lost your phone? Enter one of your recovery codes instead (e.g. 7KQ4-M2XD).">
                <Input autoFocus autoComplete="one-time-code" inputMode="text" required value={code} onChange={(e) => setCode(e.target.value)} />
              </Field>
            )}
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Signing in…" : step === "password" ? "Sign in" : "Verify"}
            </Button>
            {step === "code" && (
              <button type="button" className="w-full text-center text-xs text-slate-500 underline" onClick={() => (setStep("password"), setCode(""), setError(""))}>
                Back
              </button>
            )}
          </form>
        </Card>
      </div>
    </main>
  );
}
