"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Field, Input } from "../ui";
import { api } from "../api";

function Codes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  return (
    <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
      <p className="font-medium text-amber-900">Recovery codes — save them somewhere safe. Each works once if you lose your phone. They won&apos;t be shown again.</p>
      <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm sm:grid-cols-5">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(codes.join("\n"))}>
          Copy
        </Button>
        <Button variant="ghost" onClick={onDone}>
          I&apos;ve saved them
        </Button>
      </div>
    </div>
  );
}

export function SecurityPanel({ has2fa, required, mustEnroll, recoveryLeft, passwordChangedAt }: { has2fa: boolean; required: boolean; mustEnroll: boolean; recoveryLeft: number; passwordChangedAt: string | null }) {
  const router = useRouter();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [pw, setPw] = useState({ current: "", next: "", again: "" });
  const [confirmPw, setConfirmPw] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };
  return (
    <div className="space-y-6">
      {mustEnroll && (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Your organisation requires two-factor sign-in. Set it up below to continue using HBE Interview.
        </div>
      )}
      <Card title="Two-factor sign-in" actions={<Badge tone={has2fa ? "green" : "slate"}>{has2fa ? "on" : "off"}</Badge>}>
        {has2fa ? (
          <div className="space-y-3 text-sm">
            <p>
              Signing in needs your password and a code from your authenticator app. {recoveryLeft} recovery code(s) left.
              {required && " Required by your organisation."}
            </p>
            <Field label="Confirm your password to manage two-factor sign-in">
              <Input type="password" autoComplete="current-password" className="max-w-xs" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled={!confirmPw} onClick={() => run(async () => setCodes((await api<{ recoveryCodes: string[] }>("/api/auth/2fa/recovery", { body: { password: confirmPw } })).recoveryCodes))}>
                New recovery codes
              </Button>
              {!required && (
                <Button
                  variant="ghost"
                  disabled={!confirmPw}
                  onClick={() =>
                    confirm("Turn off two-factor sign-in?") &&
                    run(async () => {
                      await api("/api/auth/2fa/disable", { body: { password: confirmPw } });
                      setConfirmPw("");
                      router.refresh();
                    })
                  }
                >
                  Turn off
                </Button>
              )}
            </div>
            {codes && <Codes codes={codes} onDone={() => (setCodes(null), router.refresh())} />}
          </div>
        ) : codes ? (
          <Codes codes={codes} onDone={() => (setCodes(null), router.push("/app"), router.refresh())} />
        ) : !setup ? (
          <div className="space-y-3 text-sm">
            <p>Protect your account with a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…) in addition to your password.</p>
            <Button onClick={() => run(async () => setSetup(await api<{ secret: string; qr: string }>("/api/auth/2fa/setup", { method: "POST" })))}>Set up two-factor sign-in</Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-6 text-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qr} alt="QR code for your authenticator app" width={220} height={220} className="rounded border border-slate-200" />
            <div className="max-w-sm space-y-3">
              <p>1. Scan the QR code with your authenticator app, or enter this key manually:</p>
              <code className="block break-all rounded bg-slate-100 px-2 py-1 font-mono text-xs">{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</code>
              <Field label="2. Enter the 6-digit code it shows">
                <Input autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
              </Field>
              <Button disabled={code.length < 6} onClick={() => run(async () => setCodes((await api<{ recoveryCodes: string[] }>("/api/auth/2fa/enable", { body: { code } })).recoveryCodes))}>
                Verify and turn on
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card title="Password">
        <form
          className="grid max-w-xl gap-3 md:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (pw.next !== pw.again) return setMsg({ ok: false, text: "The new passwords don't match" });
            run(async () => {
              await api("/api/auth/password", { body: { current: pw.current, next: pw.next } });
              setPw({ current: "", next: "", again: "" });
              setMsg({ ok: true, text: "Password changed. Your other sessions were signed out." });
            });
          }}
        >
          <Field label="Current password">
            <Input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </Field>
          <Field label="New password" hint="10+ characters; mix letters with numbers or symbols, or use a long passphrase">
            <Input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </Field>
          <Field label="Repeat new password">
            <Input type="password" autoComplete="new-password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} />
          </Field>
          <div className="md:col-span-3">
            <Button type="submit" disabled={!pw.current || !pw.next}>
              Change password
            </Button>
            {passwordChangedAt && <span className="ml-3 text-xs text-slate-500">Last changed {new Date(passwordChangedAt).toLocaleDateString()}</span>}
          </div>
        </form>
      </Card>

      <Card title="Sessions">
        <p className="text-sm text-slate-600">Signed in on a shared or lost device? Sign out of HBE Interview everywhere, including here.</p>
        <Button
          variant="secondary"
          className="mt-3"
          onClick={() =>
            confirm("Sign out of every device, including this one?") &&
            run(async () => {
              await api("/api/auth/sessions", { method: "DELETE" });
              router.push("/login");
            })
          }
        >
          Sign out everywhere
        </Button>
      </Card>
      {msg && (
        <p role="status" className={msg.ok ? "text-sm text-emerald-700" : "text-sm text-red-600"}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
