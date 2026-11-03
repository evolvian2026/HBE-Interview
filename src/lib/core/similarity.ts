/**
 * Copied-code detection (pure). Code is normalised into tokens (identifiers, strings and numbers are made generic;
 * comments and layout are dropped), so renaming variables or reformatting doesn't hide a copy. Overlapping k-token
 * sequences are hashed and a representative subset is kept by winnowing (as in MOSS); two submissions are compared
 * by how much of the smaller one's fingerprint appears in the other.
 */
import type { Language } from "./types";

export interface Token {
  t: string;
  line: number;
}

/** [hash, first line, last line] of one selected k-gram. */
export type Fingerprint = [number, number, number];

export const SIM = {
  /** Tokens per k-gram and winnowing window. */
  k: 8,
  window: 4,
  /** Submissions with fewer fingerprints than this are too small to compare meaningfully. */
  minFingerprints: 12,
  high: 0.75,
  medium: 0.55,
  /** Leak signals for a problem. */
  leakCluster: 3,
  leakReferenceHits: 2,
} as const;

const KEYWORDS: Record<Language, string[]> = {
  python: "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield".split(" "),
  javascript: "async await break case catch class const continue debugger default delete do else export extends false finally for function if import in instanceof let new null of return super switch this throw true try typeof undefined var void while with yield".split(" "),
  java: "abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new null package private protected public return short static super switch synchronized this throw throws transient try void volatile while true false var".split(" "),
  cpp: "auto bool break case catch char class const constexpr continue default delete do double else enum explicit false float for friend if inline int long namespace new nullptr operator private protected public return short signed sizeof static struct switch template this throw true try typedef typename unsigned using virtual void while include define".split(" "),
};

const OPS = ["===", "!==", "**=", "//=", ">>=", "<<=", "...", "->", "=>", "::", "==", "!=", "<=", ">=", "&&", "||", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<", ">>", "//", "**"];

/** Language-aware tokenizer: comments and whitespace dropped; identifiers → I, strings → S, numbers → N. */
export function tokenize(code: string, language: Language): Token[] {
  const kw = new Set(KEYWORDS[language] ?? []);
  const hashComments = language === "python";
  const out: Token[] = [];
  let i = 0;
  let line = 1;
  const n = code.length;
  while (i < n) {
    const c = code[i];
    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      i++;
      continue;
    }
    // Comments
    if (hashComments && c === "#") {
      while (i < n && code[i] !== "\n") i++;
      continue;
    }
    if (!hashComments && c === "/" && code[i + 1] === "/") {
      while (i < n && code[i] !== "\n") i++;
      continue;
    }
    if (!hashComments && c === "/" && code[i + 1] === "*") {
      i += 2;
      while (i < n && !(code[i] === "*" && code[i + 1] === "/")) {
        if (code[i] === "\n") line++;
        i++;
      }
      i += 2;
      continue;
    }
    if (language === "cpp" && c === "#") {
      // Preprocessor lines (#include …) are boilerplate.
      while (i < n && code[i] !== "\n") i++;
      continue;
    }
    // Strings (including Python triple quotes and JS template literals)
    if (c === '"' || c === "'" || (c === "`" && language === "javascript")) {
      const start = line;
      const triple = hashComments && code.slice(i, i + 3) === c.repeat(3);
      const end = triple ? c.repeat(3) : c;
      i += end.length;
      while (i < n && code.slice(i, i + end.length) !== end) {
        if (code[i] === "\\") i++;
        else if (code[i] === "\n") {
          line++;
          if (!triple && c !== "`") break;
        }
        i++;
      }
      i += end.length;
      out.push({ t: "S", line: start });
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(code[i + 1] ?? ""))) {
      while (i < n && /[0-9a-fA-FxX._eE]/.test(code[i])) i++;
      out.push({ t: "N", line });
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(code[j])) j++;
      const word = code.slice(i, j);
      out.push({ t: kw.has(word) ? word : "I", line });
      i = j;
      continue;
    }
    const op = OPS.find((o) => code.startsWith(o, i));
    out.push({ t: op ?? c, line });
    i += op ? op.length : 1;
  }
  return out;
}

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Winnowed fingerprints of a token stream. */
export function fingerprints(tokens: Token[], k: number = SIM.k, w: number = SIM.window): Fingerprint[] {
  if (tokens.length < k) return [];
  const grams: Fingerprint[] = [];
  for (let i = 0; i + k <= tokens.length; i++) grams.push([fnv(tokens.slice(i, i + k).map((x) => x.t).join(" ")), tokens[i].line, tokens[i + k - 1].line]);
  const picked = new Map<number, Fingerprint>();
  let last = -1;
  for (let s = 0; s + w <= grams.length; s++) {
    let min = s;
    for (let j = s; j < s + w; j++) if (grams[j][0] <= grams[min][0]) min = j;
    if (min !== last) {
      picked.set(min, grams[min]);
      last = min;
    }
  }
  if (grams.length < w) grams.forEach((g, idx) => picked.set(idx, g));
  return [...picked.values()];
}

export function fingerprintCode(code: string, language: Language, exclude: Set<number> = new Set()): Fingerprint[] {
  return fingerprints(tokenize(code, language)).filter((f) => !exclude.has(f[0]));
}

/** Share of the smaller submission's fingerprint found in the other (0–1), and the matched line ranges on each side. */
export function compareFingerprints(a: Fingerprint[], b: Fingerprint[]) {
  const ha = new Set(a.map((f) => f[0]));
  const hb = new Set(b.map((f) => f[0]));
  if (ha.size < SIM.minFingerprints || hb.size < SIM.minFingerprints) return { score: 0, tooSmall: true, linesA: [] as [number, number][], linesB: [] as [number, number][] };
  let shared = 0;
  for (const h of ha) if (hb.has(h)) shared++;
  const score = shared / Math.min(ha.size, hb.size);
  return { score: Math.round(score * 1000) / 1000, tooSmall: false, linesA: mergeRanges(a.filter((f) => hb.has(f[0]))), linesB: mergeRanges(b.filter((f) => ha.has(f[0]))) };
}

function mergeRanges(fs: Fingerprint[]): [number, number][] {
  const r = fs.map((f) => [f[1], f[2]] as [number, number]).sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [s, e] of r) {
    const last = out[out.length - 1];
    if (last && s <= last[1] + 1) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

export function matchLevel(score: number): "high" | "medium" | null {
  return score >= SIM.high ? "high" : score >= SIM.medium ? "medium" : null;
}

export type LeakStatus = "ok" | "watch" | "likely_leaked";

/**
 * Signals that a coding problem's solution is circulating: several candidates submitting near-identical code
 * (connected by high-similarity pairs), or submissions matching a known published solution.
 */
export function leakStatus(input: { pairs: [string, string][]; referenceHits: string[] }): { status: LeakStatus; largestGroup: number; referenceCandidates: number } {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    const p = parent.get(x)!;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  for (const [a, b] of input.pairs) parent.set(find(a), find(b));
  const sizes = new Map<string, number>();
  for (const x of parent.keys()) sizes.set(find(x), (sizes.get(find(x)) ?? 0) + 1);
  const largestGroup = Math.max(0, ...sizes.values());
  const referenceCandidates = new Set(input.referenceHits).size;
  const status: LeakStatus = largestGroup >= SIM.leakCluster || referenceCandidates >= SIM.leakReferenceHits ? "likely_leaked" : largestGroup >= 2 || referenceCandidates >= 1 ? "watch" : "ok";
  return { status, largestGroup, referenceCandidates };
}
