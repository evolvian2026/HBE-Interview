"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Textarea } from "../ui";
import { api } from "../api";

/** datetime-local value (browser time) → ISO string in UTC. */
const toIso = (local: string) => (local ? new Date(local).toISOString() : "");

function SlotInputs({ slots, setSlots }: { slots: string[]; setSlots: (s: string[]) => void }) {
  return (
    <div className="space-y-2">
      {slots.map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input type="datetime-local" aria-label={`Time option ${i + 1}`} value={s} onChange={(e) => setSlots(slots.map((x, j) => (j === i ? e.target.value : x)))} className="max-w-64" />
          {slots.length > 1 && (
            <button type="button" className="text-xs text-slate-600 underline" onClick={() => setSlots(slots.filter((_, j) => j !== i))}>
              Remove
            </button>
          )}
        </div>
      ))}
      {slots.length < 5 && (
        <button type="button" className="text-xs font-medium text-brand-700 underline" onClick={() => setSlots([...slots, ""])}>
          Offer another time
        </button>
      )}
      <p className="text-xs text-slate-600">Times are in your time zone. Offer one time to book it directly, or several to let the candidate choose.</p>
    </div>
  );
}

/** Recruiters: arrange a live panel interview after the AI rounds. */
export function PanelScheduler({ candidacyId, panelists, defaultCompetencies }: { candidacyId: string; panelists: { id: string; name: string; role: string }[]; defaultCompetencies: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("Final panel interview");
  const [duration, setDuration] = useState(60);
  const [location, setLocation] = useState("");
  const [slots, setSlots] = useState<string[]>(["", ""]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [competencies, setCompetencies] = useState(defaultCompetencies.join("\n"));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open)
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Arrange a panel interview…
      </Button>
    );
  return (
    <form
      className="space-y-4 rounded-lg border border-slate-200 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        setBusy(true);
        try {
          await api(`/api/candidacies/${candidacyId}/panel`, {
            body: { title, durationMin: duration, location, slots: slots.filter(Boolean).map(toIso), panelistIds: chosen, competencies: competencies.split("\n").map((c) => c.trim()).filter(Boolean) },
          });
          setOpen(false);
          router.refresh();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} maxLength={120} />
        </Field>
        <Field label="Length (minutes)">
          <Input type="number" min={15} max={240} step={15} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
        </Field>
        <Field label="Where (video link or address)">
          <Input value={location} onChange={(e) => setLocation(e.target.value)} required minLength={3} maxLength={500} placeholder="https://meet.example.com/abc-defg" />
        </Field>
      </div>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-slate-700">Times to offer</legend>
        <SlotInputs slots={slots} setSlots={setSlots} />
      </fieldset>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-slate-700">Panel</legend>
        {panelists.length === 0 ? (
          <p className="text-sm text-slate-600">No eligible panelists: add hiring managers to this drive, or recruiters/admins, in Settings → Users.</p>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {panelists.map((p) => (
              <label key={p.id} className="flex items-center gap-1.5">
                <input type="checkbox" checked={chosen.includes(p.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, p.id] : chosen.filter((x) => x !== p.id))} />
                {p.name} <span className="text-xs text-slate-500">({p.role.replace("_", " ")})</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <Field label="Scorecard competencies (one per line, up to 8)" hint="Each panelist rates these 1–5 and gives an overall recommendation.">
        <Textarea rows={5} value={competencies} onChange={(e) => setCompetencies(e.target.value)} />
      </Field>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Sending…" : slots.filter(Boolean).length === 1 ? "Book and invite" : "Send times to the candidate"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Recruiters: offer new times, or cancel. */
export function PanelAdmin({ interviewId, cancellable }: { interviewId: string; cancellable: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [slots, setSlots] = useState<string[]>([""]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function run(path: string, body: unknown) {
    setError("");
    setBusy(true);
    try {
      await api(`/api/panel/${interviewId}/${path}`, { body });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-2 text-sm">
      {!open ? (
        <div className="flex gap-3">
          <button className="text-brand-700 underline" onClick={() => setOpen(true)}>
            Offer new times
          </button>
          {cancellable && (
            <button
              className="text-red-700 underline"
              onClick={() => {
                const reason = prompt("Why is this interview cancelled? (kept in the audit log)");
                if (reason) run("cancel", { reason });
              }}
            >
              Cancel interview
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2 rounded-lg border border-slate-200 p-3">
          <SlotInputs slots={slots} setSlots={setSlots} />
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => run("reschedule", { slots: slots.filter(Boolean).map(toIso) })}>
              Send new times
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1 text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
