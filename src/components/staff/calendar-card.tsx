"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card } from "../ui";
import { api } from "../api";

/** Connect your own calendar so panel interviews can find free times and create Meet/Teams events for you. */
export function CalendarCard({ providers, connection, notice, error }: { providers: { id: string; label: string; meetingLabel: string }[]; connection: { provider: string; label: string; email: string; error: string | null; connectedAt: string } | null; notice: string; error: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <section id="calendar">
      <Card title="Calendar">
        <div className="space-y-3 text-sm">
          <p className="text-slate-600">Connect your work calendar so schedulers can see when you're free for panel interviews (only busy/free times, never event details), and so booked interviews appear in your calendar with a video link.</p>
          {notice && (
            <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-900">
              {notice}
            </p>
          )}
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-red-800">
              {error}
            </p>
          )}
          {connection ? (
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={connection.error ? "amber" : "green"}>{connection.error ? "needs attention" : "connected"}</Badge>
              <span>{`${connection.label} · ${connection.email}`}</span>
              {connection.error && <span className="text-amber-800">{connection.error}</span>}
              <Button
                variant="secondary"
                disabled={busy}
                onClick={async () => {
                  if (!confirm("Disconnect your calendar? Interviews already in it stay there.")) return;
                  setBusy(true);
                  try {
                    await api("/api/calendar", { method: "DELETE" });
                    router.replace("/app/security#calendar");
                    router.refresh();
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Disconnect
              </Button>
              {connection.error && (
                <a href={`/api/calendar/connect/${connection.provider}`} className="font-medium text-brand-600 hover:underline">
                  Reconnect
                </a>
              )}
            </div>
          ) : providers.length ? (
            <div className="flex flex-wrap gap-2">
              {providers.map((p) => (
                <a key={p.id} href={`/api/calendar/connect/${p.id}`} className="rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
                  {`Connect ${p.label}`}
                </a>
              ))}
            </div>
          ) : (
            <p className="text-slate-600">Calendar connections aren't set up on this server yet (Google or Microsoft app credentials).</p>
          )}
        </div>
      </Card>
    </section>
  );
}
