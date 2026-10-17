/** Minimal RFC 4180-style CSV parser (quoted fields, escaped quotes, CRLF), auto-detecting , ; or tab. */
export function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t"].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(field.trim());
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field.trim());
    rows.push(row);
  }
  return rows.filter((r) => r.some(Boolean));
}

/** Extract (name, email) pairs from a CSV with an optional header row; columns may be in any order. */
export function csvToInvitees(text: string, max = 200): { name: string; email: string }[] {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.toLowerCase());
  let ni = header.findIndex((h) => /name/.test(h));
  let ei = header.findIndex((h) => /e-?mail/.test(h));
  const hasHeader = ni >= 0 || ei >= 0;
  if (!hasHeader || ei < 0) ei = rows[hasHeader ? 1 : 0]?.findIndex((c) => c.includes("@")) ?? -1;
  if (ni < 0) ni = ei === 0 ? 1 : 0;
  return rows
    .slice(hasHeader ? 1 : 0)
    .map((r) => ({ name: r[ni] ?? "", email: r[ei] ?? "" }))
    .filter((p) => p.email.includes("@"))
    .slice(0, max);
}

/** One CSV cell for export: JSON for objects, formula-looking text neutralised (CSV injection), always quoted. */
export function csvCell(v: unknown): string {
  const s = v == null ? "" : typeof v === "string" ? v : JSON.stringify(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

