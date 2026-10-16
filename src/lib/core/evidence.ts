/** Server-side verification of evaluator evidence quotes (ARCHITECTURE §9.5). */

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    // Unicode-aware: keep letters, combining marks and digits of any script (Hindi, Arabic, …).
    .replace(/[^\p{L}\p{M}\p{N}'"\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  return normalize(s).split(" ").filter(Boolean);
}

/**
 * True when `quote` appears in `source`: exact normalised substring, or token coverage ≥ threshold
 * (share of quote tokens present in the best-matching window of the source).
 */
export function quoteMatches(quote: string, source: string, threshold = 0.9): boolean {
  const q = normalize(quote).replace(/^\.+|\.+$/g, "");
  if (!q) return false;
  const src = normalize(source);
  if (src.includes(q)) return true;
  const qt = tokens(quote);
  const st = tokens(source);
  if (qt.length === 0 || st.length === 0) return false;
  const win = qt.length;
  let best = 0;
  for (let i = 0; i <= Math.max(0, st.length - win); i++) {
    const window = new Set(st.slice(i, i + win + 2));
    let hit = 0;
    for (const t of qt) if (window.has(t)) hit++;
    best = Math.max(best, hit / qt.length);
    if (best >= threshold) return true;
  }
  return best >= threshold;
}
