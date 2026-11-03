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
/** datetime-local value for an ISO instant, in the browser's time zone. */
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fmtSlot = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export interface CalendarInfo {
  /** People (the scheduler and panelists) with a connected calendar. */
  connectedIds: string[];
  meIncluded: boolean;
  meetingLabel: string | null;
}

export function PanelScheduler({ candidacyId, panelists, defaultCompetencies, calendar }: { candidacyId: string; panelists: { id: string; name: string; role: string }[]; defaultCompetencies: string[]; calendar?: CalendarInfo }) {
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
  const [autoMeeting, setAutoMeeting] = useState(false);
  const [suggest, setSuggest] = useState<{ slots: string[]; checked: string[]; notConnected: string[]; failed: { name: string; reason: string }[] } | null>(null);
  const [finding, setFinding] = useState(false);
  const canMeet = !!calendar?.meetingLabel && (calendar.meIncluded || chosen.some((id) => calendar.connectedIds.includes(id)));
  const addSlot = (iso: string) => {
    const v = toLocalInput(iso);
    if (slots.includes(v)) return;
    const empty = slots.indexOf("");
    setSlots(empty >= 0 ? slots.map((s, i) => (i === empty ? v : s)) : slots.length < 5 ? [...slots, v] : slots);
  };
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
            body: { title, durationMin: duration, location, autoMeeting: autoMeeting && canMeet, slots: slots.filter(Boolean).map(toIso), panelistIds: chosen, competencies: competencies.split("\n").map((c) => c.trim()).filter(Boolean) },
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
        <Field label="Where (video link or address)" hint={autoMeeting && canMeet ? `The ${calendar?.meetingLabel} link is created when the time is booked.` : undefined}>
          <Input value={location} onChange={(e) => setLocation(e.target.value)} required={!(autoMeeting && canMeet)} minLength={autoMeeting && canMeet ? 0 : 3} maxLength={500} disabled={autoMeeting && canMeet} placeholder={autoMeeting && canMeet ? "Created automatically" : "https://meet.example.com/abc-defg"} />
        </Field>
      </div>
      {calendar?.meetingLabel && (
        <label className={`flex items-start gap-2 text-sm ${canMeet ? "" : "opacity-60"}`}>
          <input type="checkbox" className="mt-1" checked={autoMeeting && canMeet} disabled={!canMeet} onChange={(e) => setAutoMeeting(e.target.checked)} />
          <span>{canMeet ? `Create the video meeting automatically (${calendar.meetingLabel}) and put the interview in the panel's calendars` : "Connect your calendar (Security page), or choose a panelist who has, to create the video meeting automatically"}</span>
        </label>
      )}
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-slate-700">Times to offer</legend>
        <SlotInputs slots={slots} setSlots={setSlots} />
        {calendar && (
          <div className="mt-2 space-y-2 text-sm">
            <Button
              type="button"
              variant="secondary"
              disabled={finding || !chosen.length}
              title={!chosen.length ? "Choose the panel first" : undefined}
              onClick={async () => {
                setFinding(true);
                setError("");
                try {
                  setSuggest(await api("/api/calendar/suggest", { body: { panelistIds: chosen, durationMin: duration, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, days: 10, workStartHour: 9, workEndHour: 18 } }));
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setFinding(false);
                }
              }}
            >
              {finding ? "Checking calendars…" : "Suggest times when the panel is free"}
            </Button>
            {suggest && (
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-700">
                  {`Weekdays 9:00–18:00 your time, next 10 days. Checked: ${suggest.checked.join(", ") || "nobody"}.`}
                  {suggest.notConnected.length > 0 && ` Not connected (check with them): ${suggest.notConnected.join(", ")}.`}
                  {suggest.failed.map((f) => ` ${f.name}: ${f.reason}`).join("")}
                </p>
                {suggest.slots.length === 0 ? (
                  <p className="mt-1 text-xs text-slate-700">No common free time found.</p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Suggested times">
                    {suggest.slots.map((s) => (
                      <button key={s} type="button" onClick={() => addSlot(s)} className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-800 ring-1 ring-slate-300 hover:bg-brand-50">
                        {`+ ${fmtSlot(s)}`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
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
