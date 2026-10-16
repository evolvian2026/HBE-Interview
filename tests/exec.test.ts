import { describe, expect, it } from "vitest";

process.env.CODE_EXECUTOR = "local-dev";

const py = `import sys
def main():
    data = sys.stdin.read().split("\\n")
    n, t = map(int, data[0].split()); a = list(map(int, data[1].split()))
    seen = {}
    for j, x in enumerate(a):
        if t - x in seen:
            print(seen[t-x], j); return
        if x not in seen: seen[x] = j
    print(-1, -1)
main()
`;
const js = `const L = require("fs").readFileSync(0, "utf8").split("\\n");
const [n, t] = L[0].split(" ").map(Number); const a = L[1].split(" ").map(Number);
const seen = new Map(); let out = "-1 -1";
for (let j = 0; j < a.length; j++) { if (seen.has(t - a[j])) { out = seen.get(t - a[j]) + " " + j; break; } if (!seen.has(a[j])) seen.set(a[j], j); }
console.log(out);
`;
const java = `import java.util.*; import java.io.*;
public class Main { public static void main(String[] x) throws IOException {
  BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
  String[] h = br.readLine().trim().split(" "); long t = Long.parseLong(h[1]);
  String[] p = br.readLine().trim().split(" "); Map<Long,Integer> seen = new HashMap<>();
  for (int j = 0; j < p.length; j++) { long v = Long.parseLong(p[j]); if (seen.containsKey(t - v)) { System.out.println(seen.get(t - v) + " " + j); return; } seen.putIfAbsent(v, j); }
  System.out.println("-1 -1"); } }
`;
const cpp = `#include <bits/stdc++.h>
using namespace std; int main(){ long long n,t; cin>>n>>t; vector<long long>a(n); for(auto&x:a)cin>>x; unordered_map<long long,int> s;
for(int j=0;j<n;j++){ if(s.count(t-a[j])){ cout<<s[t-a[j]]<<" "<<j<<"\\n"; return 0;} if(!s.count(a[j])) s[a[j]]=j; } cout<<"-1 -1\\n"; }
`;

describe("local executor", () => {
  it("runs all four languages against the two-sum hidden tests", async () => {
    const { executeTests, normalizeOutput } = await import("@/lib/exec");
    const { problemById } = await import("@/lib/content");
    expect(normalizeOutput("a  \nb\n\n")).toBe("a\nb");
    const p = problemById("two-sum")!;
    for (const [lang, code] of [["python", py], ["javascript", js], ["java", java], ["cpp", cpp]] as const) {
      const r = await executeTests(lang, code, p.hidden, { revealIO: false });
      expect(r.passed, `${lang}: ${JSON.stringify(r.results.map((x) => x.verdict))}`).toBe(r.total);
    }
    const wrong = await executeTests("python", "print('0 1')", p.hidden, { revealIO: false });
    expect(wrong.passed).toBeLessThan(wrong.total);
    const ce = await executeTests("cpp", "int main( {", p.samples, { revealIO: true });
    expect(ce.compileError).toBeTruthy();
  }, 120_000);
});
