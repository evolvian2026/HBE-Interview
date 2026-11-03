import { describe, expect, it } from "vitest";
import { SIM, compareFingerprints, fingerprintCode, leakStatus, matchLevel, tokenize } from "@/lib/core/similarity";
import { STARTER_CODE } from "@/lib/content";

const original = `import sys

def solve(data):
    lines = data.strip().split("\\n")
    n, target = map(int, lines[0].split())
    nums = list(map(int, lines[1].split()))
    seen = {}
    for i, x in enumerate(nums):
        need = target - x
        if need in seen:
            return f"{seen[need]} {i}"
        seen[x] = i
    return "-1 -1"

if __name__ == "__main__":
    print(solve(sys.stdin.read()))
`;

// Same logic, renamed variables, different comments, strings and layout.
const disguised = `import sys
# my own solution!!
def solve(inp):
    rows = inp.strip().split('\\n')
    count, goal = map(int, rows[0].split())
    arr = list(map(int, rows[1].split()))
    index_of = {}   # value -> index
    for pos, val in enumerate(arr):
        want = goal - val
        if want in index_of:
            return f"{index_of[want]} {pos}"
        index_of[val] = pos
    return 'none'


if __name__ == "__main__":
    print(solve(sys.stdin.read()))
`;

// A different, independent approach to the same problem (sorting + two pointers).
const independent = `import sys

def solve(data):
    first, second = data.strip().split("\\n")[:2]
    _, t = first.split()
    t = int(t)
    values = sorted((int(v), k) for k, v in enumerate(second.split()))
    lo, hi = 0, len(values) - 1
    while lo < hi:
        total = values[lo][0] + values[hi][0]
        if total == t:
            a, b = sorted((values[lo][1], values[hi][1]))
            return str(a) + " " + str(b)
        elif total < t:
            lo += 1
        else:
            hi -= 1
    return "-1 -1"

print(solve(sys.stdin.read()))
`;

describe("tokenizer", () => {
  it("drops comments and makes identifiers, strings and numbers generic", () => {
    const t = tokenize(`x = 42  # answer\ny = "hi"`, "python").map((x) => x.t);
    expect(t).toEqual(["I", "=", "N", "I", "=", "S"]);
    const j = tokenize(`// c\nconst a = b /* x */ + 'q';`, "javascript").map((x) => x.t);
    expect(j).toEqual(["const", "I", "=", "I", "+", "S", ";"]);
  });
  it("keeps line numbers for highlighting", () => {
    const t = tokenize(`a\n\n"""multi\nline"""\nb`, "python");
    expect(t.map((x) => x.line)).toEqual([1, 3, 5]);
  });
  it("ignores C++ preprocessor lines and Java/C++ keywords stay distinct", () => {
    expect(tokenize(`#include <bits/stdc++.h>\nint main(){return 0;}`, "cpp").map((x) => x.t)).toEqual(["int", "I", "(", ")", "{", "return", "N", ";", "}"]);
  });
});

describe("similarity", () => {
  const starter = new Set(fingerprintCode(STARTER_CODE.python, "python").map((f) => f[0]));
  const a = fingerprintCode(original, "python", starter);
  it("sees through renamed variables, comments and reformatting", () => {
    const r = compareFingerprints(a, fingerprintCode(disguised, "python", starter));
    expect(r.score).toBeGreaterThanOrEqual(SIM.high);
    expect(matchLevel(r.score)).toBe("high");
    expect(r.linesA.length).toBeGreaterThan(0);
  });
  it("doesn't flag an independent solution to the same problem", () => {
    const r = compareFingerprints(a, fingerprintCode(independent, "python", starter));
    expect(r.score).toBeLessThan(SIM.medium);
    expect(matchLevel(r.score)).toBeNull();
  });
  it("ignores the starter template and tiny submissions", () => {
    const s = fingerprintCode(STARTER_CODE.python, "python", starter);
    expect(s.length).toBe(0);
    expect(compareFingerprints(fingerprintCode("print(1)", "python"), a).tooSmall).toBe(true);
  });
  it("is identical for identical code", () => {
    expect(compareFingerprints(a, a).score).toBe(1);
  });
});

describe("leak status", () => {
  it("flags a problem when a group of candidates share code or match a published solution", () => {
    expect(leakStatus({ pairs: [], referenceHits: [] }).status).toBe("ok");
    expect(leakStatus({ pairs: [["a", "b"]], referenceHits: [] }).status).toBe("watch");
    expect(leakStatus({ pairs: [["a", "b"], ["b", "c"]], referenceHits: [] })).toMatchObject({ status: "likely_leaked", largestGroup: 3 });
    expect(leakStatus({ pairs: [], referenceHits: ["x", "y", "x"] })).toMatchObject({ status: "likely_leaked", referenceCandidates: 2 });
    expect(leakStatus({ pairs: [["a", "b"], ["c", "d"]], referenceHits: [] }).largestGroup).toBe(2);
  });
});

describe("retired problems", () => {
  it("never leaves the picker without a problem", async () => {
    const { PROBLEMS, pickProblem } = await import("@/lib/content");
    const all = PROBLEMS.map((p) => p.id);
    expect(pickProblem({ difficulty: ["easy"], domain: "", skills: [], exclude: all })).toBeTruthy();
    const keep = all[0];
    expect(pickProblem({ difficulty: ["easy", "medium", "hard"], domain: "", skills: [], exclude: all.filter((x) => x !== keep) }).id).toBe(keep);
  });
});
