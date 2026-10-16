/** Pure helpers for the HR knowledge base: passage chunking and full-text query building. */

/** Knowledge bases up to this size are placed whole in the (cached) HR dossier; larger ones use passage retrieval. */
export const KB_INLINE_LIMIT = 60_000;

/** Split a document into passages of roughly `target` characters, breaking at paragraphs, then lines, then sentences. */
export function chunkText(content: string, target = 1200, max = 1800): string[] {
  const text = content.replace(/\r\n/g, "\n").trim();
  if (!text) return [];
  const pieces: string[] = [];
  for (const para of text.split(/\n\s*\n/)) {
    if (para.length <= max) pieces.push(para.trim());
    else {
      for (const line of para.split("\n")) {
        if (line.length <= max) pieces.push(line.trim());
        else {
          // Very long line: split on sentence ends, then hard-wrap.
          let buf = "";
          for (const s of line.split(/(?<=[.!?।])\s+/)) {
            if ((buf + " " + s).length > max && buf) {
              pieces.push(buf.trim());
              buf = "";
            }
            buf += (buf ? " " : "") + s;
            while (buf.length > max) {
              pieces.push(buf.slice(0, max));
              buf = buf.slice(max);
            }
          }
          if (buf.trim()) pieces.push(buf.trim());
        }
      }
    }
  }
  const out: string[] = [];
  let cur = "";
  for (const p of pieces.filter(Boolean)) {
    if (cur && cur.length + p.length + 2 > target) {
      out.push(cur);
      cur = "";
    }
    cur += (cur ? "\n\n" : "") + p;
  }
  if (cur) out.push(cur);
  return out;
}

const STOP = new Set(
  "the a an and or but if then of to in on at for from by with about as is are was were be been being do does did can could will would should may might must i me my we our you your he she it they them their this that these those what which who whom when where why how there here have has had not no yes please tell know want like get got any some much many more most also just than so very".split(" "),
);

/**
 * Build a Postgres `to_tsquery('simple', …)` OR-query from a candidate's question: unique words of 3+ letters
 * (any script), minus common English stop words, prefix-matched. Returns null when nothing is searchable.
 */
export function ftsQuery(text: string, maxTerms = 12): string | null {
  const words = (text.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? []).filter((w) => w.length >= 3 && !STOP.has(w));
  const uniq = [...new Set(words)].slice(0, maxTerms);
  return uniq.length ? uniq.map((w) => `${w}:*`).join(" | ") : null;
}
