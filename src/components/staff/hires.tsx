"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Select, Textarea } from "../ui";
import { api } from "../api";

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function run(fn: () => Promise<string | void>) {
    setBusy(true);
    setMsg("");
    try {
      const m = await fn();
      if (m) setMsg(m);
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { busy, msg, run };
}

const Status = ({ msg }: { msg: string }) =>
  msg ? (
    <span role="status" className="text-xs text-slate-700">
      {msg}
    </span>
  ) : null;

const today = () => new Date().toISOString().slice(0, 10);

/** Recruiter actions on a hire: joined (date + manager), declined, left. */
export function HireActions({ hireId, status, staff, managerId }: { hireId: string; status: string; staff: { id: string; name: string }[]; managerId: string | null }) {
  const { busy, msg, run } = useAction();
  const [mode, setMode] = useState<"" | "joined" | "left">("");
  const [date, setDate] = useState(today());
  const [manager, setManager] = useState(managerId ?? staff[0]?.id ?? "");
  const [reason, setReason] = useState("resigned");
  const post = (body: object, done: string) => run(async () => (await api(`/api/hires/${hireId}`, { body }), setMode(""), done));
  if (status === "declined" || status === "left") return <Status msg={msg} />;
  return (
    <div className="space-y-2 text-sm">
      {mode === "" && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => setMode("joined")}>
            {status === "joined" ? "Change joining / manager" : "Joined…"}
          </Button>
          {status === "offered" && (
            <Button variant="ghost" disabled={busy} onClick={() => confirm("Mark the offer as declined?") && post({ action: "declined" }, "Marked as declined.")}>
              Declined
            </Button>
          )}
          {status === "joined" && (
            <Button variant="ghost" disabled={busy} onClick={() => setMode("left")}>
              Left…
            </Button>
          )}
        </div>
      )}
      {mode === "joined" && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Joining date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Manager (gives the 90/180-day reviews)">
            <Select value={manager} onChange={(e) => setManager(e.target.value)}>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button disabled={busy || !manager} onClick={() => post({ action: "joined", joinedAt: date, managerId: manager }, "Saved — reviews scheduled.")}>
            Save
          </Button>
          <Button variant="ghost" onClick={() => setMode("")}>
            Cancel
          </Button>
        </div>
      )}
      {mode === "left" && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Leaving date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Reason">
            <Select value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="resigned">Resigned</option>
              <option value="let_go">Let go</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Button disabled={busy} onClick={() => post({ action: "left", leftAt: date, reason }, "Saved.")}>
            Save
          </Button>
          <Button variant="ghost" onClick={() => setMode("")}>
            Cancel
          </Button>
        </div>
      )}
      <Status msg={msg} />
    </div>
  );
}

function Scale({ label, value, onChange, optional }: { label: string; value: number | null; onChange: (v: number | null) => void; optional?: boolean }) {
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium text-slate-700">{label}</legend>
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${value === n ? "border-brand-600 bg-brand-50 font-semibold" : "border-slate-300"}`}>
            <input type="radio" className="sr-only" name={label} checked={value === n} onChange={() => onChange(n)} />
            {n}
          </label>
        ))}
        {optional && (
          <label className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${value == null ? "border-brand-600 bg-brand-50" : "border-slate-300"}`}>
            <input type="radio" className="sr-only" name={label} checked={value == null} onChange={() => onChange(null)} />
            Not sure
          </label>
        )}
      </div>
    </fieldset>
  );
}

/** The manager's check-in. Interview scores are not shown here. */
export function HireReviewForm({ reviewId, initial }: { reviewId: string; initial: { rating: number | null; technical: number | null; collaboration: number | null; values: number | null; wouldRehire: string | null; note: string } }) {
  const { busy, msg, run } = useAction();
  const [v, setV] = useState(initial);
  return (
    <div className="space-y-4">
      <Scale label="Overall, how are they doing? (1 = well below expectations, 5 = well above)" value={v.rating} onChange={(x) => setV({ ...v, rating: x })} />
      <Scale label="Skills for the role" value={v.technical} onChange={(x) => setV({ ...v, technical: x })} optional />
      <Scale label="Working with others" value={v.collaboration} onChange={(x) => setV({ ...v, collaboration: x })} optional />
      <Scale label="Fit with how we work (values)" value={v.values} onChange={(x) => setV({ ...v, values: x })} optional />
      <Field label="Knowing what you know now, would you hire them again?">
        <Select value={v.wouldRehire ?? ""} onChange={(e) => setV({ ...v, wouldRehire: e.target.value })}>
          <option value="">Choose…</option>
          <option value="yes">Yes</option>
          <option value="unsure">Not sure</option>
          <option value="no">No</option>
        </Select>
      </Field>
      <Field label="Anything to add (optional)" hint="Kept with the review. Cleared if the person's interview data is deleted.">
        <Textarea rows={3} value={v.note} maxLength={3000} onChange={(e) => setV({ ...v, note: e.target.value })} />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={busy || !v.rating || !v.wouldRehire} onClick={() => run(async () => (await api(`/api/hires/reviews/${reviewId}`, { body: { ...v, note: v.note || undefined } }), "Thanks — review saved."))}>
          Submit review
        </Button>
        <Status msg={msg} />
      </div>
    </div>
  );
}
