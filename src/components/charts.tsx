/**
 * Minimal, accessible chart primitives (single-hue magnitude charts) following the dataviz method:
 * thin marks with 4px rounded data-ends from one baseline, text in text tokens (never the series color),
 * per-mark hover/focus tooltips, selective direct labels, and a table view for every chart.
 */
import { cx } from "./ui";

const SERIES = "#2a78d6"; // categorical slot 1 (validated) — used as the single magnitude hue

export function StatTile({ label, value, sub, className }: { label: string; value: string; sub?: string; className?: string }) {
  return (
    <div className={cx("rounded-xl border border-slate-200 bg-white p-4", className)}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

export interface BarRow {
  label: string;
  value: number;
  /** Text shown at the bar tip and in the tooltip, e.g. "42" or "3.8/5". */
  display?: string;
  hint?: string;
}

/** Horizontal bars for comparing magnitude across a handful of categories (value at the tip). */
export function BarList({ rows, max, caption, labelWidth = "w-44" }: { rows: BarRow[]; max?: number; caption: string; labelWidth?: string }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <figure>
      <figcaption className="sr-only">{caption}</figcaption>
      <ul className="space-y-2" role="list">
        {rows.map((r) => {
          const pct = top ? Math.max(0, Math.min(100, (r.value / top) * 100)) : 0;
          const text = r.display ?? String(r.value);
          return (
            <li key={r.label} className="flex items-center gap-3 text-sm">
              <span className={cx("shrink-0 truncate text-slate-600", labelWidth)} title={r.label}>
                {r.label}
              </span>
              <span className="group relative flex h-6 flex-1 items-center" tabIndex={0} role="img" aria-label={`${r.label}: ${text}`}>
                <span
                  className="h-4 rounded-r-[4px] transition-opacity group-hover:opacity-80 group-focus:opacity-80"
                  style={{ width: `${pct}%`, minWidth: r.value > 0 ? 3 : 0, background: SERIES }}
                />
                <span className="ml-2 text-xs tabular-nums text-slate-700">{text}</span>
                <Tooltip value={text} label={r.hint ? `${r.label} · ${r.hint}` : r.label} />
              </span>
            </li>
          );
        })}
      </ul>
      <TableView headers={["Category", "Value"]} rows={rows.map((r) => [r.label, r.display ?? String(r.value)])} />
    </figure>
  );
}

/** Column histogram over fixed bins (e.g. score 0–100 in bins of 10) with an optional reference line. */
export function Histogram({
  bins,
  caption,
  reference,
  height = 140,
}: {
  bins: { label: string; count: number }[];
  caption: string;
  reference?: { atIndex: number; label: string };
  height?: number;
}) {
  const top = Math.max(1, ...bins.map((b) => b.count));
  const peak = bins.reduce((best, b, i) => (b.count > bins[best].count ? i : best), 0);
  return (
    <figure>
      <figcaption className="sr-only">{caption}</figcaption>
      <div className="relative mt-4 flex items-end gap-[2px] border-b border-slate-300" style={{ height }}>
        {reference && (
          <div className="pointer-events-none absolute inset-y-0 border-l border-dashed border-slate-600" style={{ left: `${(reference.atIndex / bins.length) * 100}%` }}>
            <span className="absolute -top-4 -translate-x-1/2 whitespace-nowrap text-[10px] text-slate-600">{reference.label}</span>
          </div>
        )}
        {bins.map((b, i) => (
          <div key={b.label} className="group relative flex h-full flex-1 items-end justify-center" tabIndex={0} role="img" aria-label={`${b.label}: ${b.count}`}>
            {i === peak && b.count > 0 && (
              <span className="absolute text-[10px] tabular-nums text-slate-700" style={{ bottom: `calc(${(b.count / top) * 100}% + 2px)` }}>
                {b.count}
              </span>
            )}
            <div className="w-full max-w-6 rounded-t-[4px] transition-colors group-hover:opacity-80" style={{ height: `${(b.count / top) * 100}%`, background: SERIES, minHeight: b.count ? 2 : 0 }} />
            <Tooltip value={String(b.count)} label={b.label} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[2px] text-[10px] text-slate-500">
        {bins.map((b, i) => (
          <span key={b.label} className="flex-1 text-center">
            {i % 2 === 0 ? b.label.split("–")[0] : ""}
          </span>
        ))}
      </div>
      <TableView headers={["Bin", "Count"]} rows={bins.map((b) => [b.label, String(b.count)])} />
    </figure>
  );
}

function Tooltip({ value, label }: { value: string; label: string }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none invisible absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs text-white opacity-0 shadow transition group-hover:visible group-hover:opacity-100 group-focus:visible group-focus:opacity-100"
    >
      <b className="tabular-nums">{value}</b> <span className="text-slate-300">{label}</span>
    </span>
  );
}

function TableView({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <details className="mt-2 text-xs text-slate-500">
      <summary className="cursor-pointer">View as table</summary>
      <table className="mt-1 w-full">
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} className="py-0.5 text-left font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className="py-0.5 tabular-nums text-slate-700">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
