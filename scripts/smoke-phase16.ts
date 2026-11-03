/**
 * Phase 16 checks: copied-code detection — fingerprinting final submissions (past rounds and rounds as they end),
 * catching disguised copies but not independent solutions, review with notes, report and inbox flags, known
 * published solutions, leak status, retiring a problem, roles and organisation isolation.
 * Runs against a dev server with AI_MOCK=true after `npm run smoke`.
 *   BASE_URL=http://localhost:3000 npx tsx scripts/smoke-phase16.ts
 */
import "./load-env";
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
let passed = 0;
function check(cond: unknown, msg: string) {
  if (!cond) throw new Error(`CHECK FAILED: ${msg}`);
  passed++;
  console.log("✓", msg);
}

class Client {
  cookies = new Map<string, string>();
  async req(method: string, path: string, body?: unknown) {
    const res = await fetch(BASE + path, {
      method,
      redirect: "manual",
      headers: {
        ...(this.cookies.size ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
        ...(body !== undefined ? { "content-type": "application/json", origin: BASE } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const sc of res.headers.getSetCookie()) {
      const [kv] = sc.split(";");
      const i = kv.indexOf("=");
      if (!kv.slice(i + 1) || /max-age=0/i.test(sc)) this.cookies.delete(kv.slice(0, i));
      else this.cookies.set(kv.slice(0, i), kv.slice(i + 1));
    }
    return { status: res.status, text: await res.text(), type: res.headers.get("content-type") ?? "" };
  }
  async json<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await this.req(method, path, body);
    if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status}: ${r.text}`);
    return JSON.parse(r.text || "{}") as T;
  }
  async login(email: string, password: string) {
    const r = await this.req("POST", "/api/auth/login", { email, password });
    if (r.status !== 200) throw new Error(`login ${email} → ${r.status} ${r.text}`);
    return this;
  }
}

async function waitFor<T>(label: string, fn: () => Promise<T | null | undefined | false>, timeoutMs = 90_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}
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


// Published solution found "online": the independent approach with different names.
const published = independent.replace(/values/g, "pairs").replace(/total/g, "s").replace(/\blo\b/g, "left").replace(/\bhi\b/g, "right");

type Q = <T = Record<string, unknown>>(sql: string, args?: unknown[]) => Promise<T[]>;
const PROBLEM = "two-sum";

async function main() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const q: Q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const stamp = Date.now();
  const admin = await new Client().login(process.env.ADMIN_EMAIL!, process.env.ADMIN_PASSWORD!);
  const [{ org_id: orgId }] = await q<{ org_id: string }>("select org_id from users where email = $1", [process.env.ADMIN_EMAIL!.toLowerCase()]);
  try {
    await run(admin, orgId, q, stamp);
  } finally {
    await admin.json("POST", `/api/code-similarity/problems/${PROBLEM}`, { retired: false }).catch(() => undefined);
    await db.end();
  }
  console.log(`\nPHASE 16 CHECKS PASSED (${passed} checks)`);
}

async function run(admin: Client, orgId: string, q: Q, stamp: number) {
  // Start clean for this problem (dev data only).
  await q("delete from code_matches where org_id = $1", [orgId]);
  await q("delete from code_references where org_id = $1", [orgId]);
  await q("delete from code_fingerprints where org_id = $1", [orgId]);
  await q("delete from rate_limits where key like 'code-scan:%'");

  const [tpl] = await q<{ state: Record<string, unknown> }>("select state from round_sessions where state->'exercises' ? 'coding' and round_type = 'technical' order by created_at desc limit 1");
  if (!tpl) throw new Error("Run `npm run smoke` first (needs a technical round with coding)");
  const state = JSON.parse(JSON.stringify(tpl.state)) as { exercises: Record<string, { refId: string }> };
  state.exercises = { coding: { ...state.exercises.coding, refId: PROBLEM } };
  const [drive] = await q<{ id: string }>("select id from drives where org_id = $1 and status = 'active' order by created_at desc limit 1", [orgId]);

  const people: Record<string, { cid: string; sid: string; name: string }> = {};
  for (const [key, name, code, status] of [
    ["a", "Arjun Original", original, "ended"],
    ["b", "Bela Copy", disguised, "ended"],
    ["c", "Chandra Own", independent, "ended"],
    ["d", "Dev Late", original.replace(/seen/g, "lookup").replace(/need/g, "rest"), "active"],
  ] as const) {
    const inv = await admin.json<{ results: { link: string }[] }>("POST", `/api/drives/${drive.id}/invites`, { candidates: [{ name, email: `${key}.code.${stamp}@example.com` }] });
    const token = inv.results[0].link.split("/c/")[1];
    const [{ id: cid }] = await q<{ id: string }>("select id from candidacies where access_token = $1", [token]);
    await q("update candidacies set stage = 'in_round', current_round_index = 0 where id = $1", [cid]);
    const deadline = status === "active" ? "now() - interval '10 minutes'" : "now()";
    const [{ id: sid }] = await q<{ id: string }>(
      `insert into round_sessions (candidacy_id, round_index, round_type, status, mode, language, state, started_at, deadline_at, ended_at, last_heartbeat_at)
       values ($1, 0, 'technical', $2, 'text', 'en', $3, now() - interval '50 minutes', ${deadline}, ${status === "ended" ? "now()" : "null"}, now()) returning id`,
      [cid, status, JSON.stringify(state)],
    );
    await q("insert into code_runs (session_id, problem_id, kind, language, code, results) values ($1, $2, 'submit', 'python', $3, $4)", [sid, PROBLEM, code, JSON.stringify({ passed: 5, total: 5 })]);
    people[key] = { cid, sid, name };
  }

  const pw = "Lantern-Quarry-63";
  const mk = async (name: string, role: string) => {
    const email = `${name.toLowerCase().split(" ")[0]}.code.${stamp}@hbe.local`;
    await admin.json("POST", "/api/settings/users", { name, email, password: pw, role });
    return new Client().login(email, pw);
  };
  const recruiter = await mk("Rhea Code", "recruiter");
  const hm = await mk("Hemant Code", "hiring_manager");

  /* ------------------------------- Detection ------------------------------- */
  check((await recruiter.req("POST", "/api/code-similarity/scan", {})).status === 403, "only admins start a check of past rounds");
  const scan = await admin.json<{ queued: number }>("POST", "/api/code-similarity/scan", {});
  check(scan.queued >= 3, `past rounds are queued for checking (${scan.queued})`);
  const fps = await waitFor("fingerprints", async () => {
    const r = await q<{ session_id: string }>("select session_id from code_fingerprints where session_id = any($1::uuid[])", [[people.a.sid, people.b.sid, people.c.sid]]);
    return r.length === 3 ? r : null;
  });
  check(fps.length === 3, "each final submission is fingerprinted");
  const pairs = await waitFor("matches", async () => {
    const r = await q<{ id: string; score: number; level: string; a: string; b: string }>(
      `select m.id, m.score, m.level, fa.candidacy_id a, fb.candidacy_id b from code_matches m join code_fingerprints fa on fa.id = m.a_id join code_fingerprints fb on fb.id = m.b_id where m.org_id = $1`,
      [orgId],
    );
    return r.length ? r : null;
  });
  const ab = pairs.find((p) => [p.a, p.b].sort().join() === [people.a.cid, people.b.cid].sort().join());
  check(ab && ab.level === "high" && ab.score >= 0.75, `a copy with renamed variables, new comments and layout is caught (${Math.round((ab?.score ?? 0) * 100)}%)`);
  check(!pairs.some((p) => [p.a, p.b].includes(people.c.cid)), "an independent solution to the same problem is not flagged");
  const sameCand = await q("select 1 from code_matches m join code_fingerprints fa on fa.id = m.a_id join code_fingerprints fb on fb.id = m.b_id where fa.candidacy_id = fb.candidacy_id");
  check(sameCand.length === 0, "a candidate is never matched with themselves");

  /* ------------------------------- Visibility ------------------------------- */
  const list = await recruiter.req("GET", "/app/code-similarity");
  check(list.status === 200 && list.text.includes(people.a.name) && list.text.includes(people.b.name) && list.text.includes("to review"), "recruiters see matches to review");
  check(list.text.includes("Pair With Target Sum") && list.text.includes("watch"), "the problem is marked to watch");
  check((await hm.req("GET", "/app/code-similarity")).status === 307, "hiring managers don't see the copied-code checks");
  check((await hm.req("POST", `/api/code-similarity/matches/${ab!.id}`, { status: "coincidence" })).status === 403, "hiring managers can't review matches");
  const detail = await recruiter.req("GET", `/app/code-similarity/${ab!.id}`);
  check(detail.status === 200 && detail.text.includes("index_of") && detail.text.includes("seen[x] = i") && detail.text.includes("bg-amber-100"), "the match page shows both submissions with the shared lines highlighted");
  const report = await admin.req("GET", `/app/candidates/${people.b.cid}`);
  check(report.text.includes("similar code") && report.text.includes("Context only"), "the candidate report flags similar code as context");
  check((await recruiter.req("GET", "/app/inbox")).text.includes("Similar code to review"), "recruiters' inbox lists code matches to review");

  /* --------------------------------- Review --------------------------------- */
  check((await recruiter.req("POST", `/api/code-similarity/matches/${ab!.id}`, { status: "copied" })).status === 400, "marking as copied needs a note");
  await recruiter.json("POST", `/api/code-similarity/matches/${ab!.id}`, { status: "coincidence", note: "Common approach" });
  check((await admin.req("GET", `/app/candidates/${people.b.cid}`)).text.includes("0 to review"), "a reviewed match is no longer waiting");
  await recruiter.json("POST", `/api/code-similarity/matches/${ab!.id}`, { status: "copied", note: "Same unusual structure and the same fallback string pattern; submitted 20 minutes apart." });
  const [rev] = await q<{ status: string; reviewed_by: string | null; review_note: string }>("select status, reviewed_by, review_note from code_matches where id = $1", [ab!.id]);
  check(rev.status === "copied" && rev.reviewed_by && rev.review_note.includes("unusual"), "the conclusion and note are recorded");
  check((await admin.req("GET", `/app/candidates/${people.a.cid}`)).text.includes("marked likely copied"), "both candidates' reports show the conclusion");

  /* ----------------------- A round ending normally is checked ----------------------- */
  await waitFor("Dev's round to be closed and checked", async () => {
    const r = await q("select 1 from code_fingerprints where session_id = $1", [people.d.sid]);
    return r.length ? r : null;
  }, 120_000);
  const dMatches = await waitFor("Dev's matches", async () => {
    const r = await q<{ id: string }>("select m.id from code_matches m join code_fingerprints f on f.id in (m.a_id, m.b_id) where f.session_id = $1", [people.d.sid]);
    return r.length >= 2 ? r : null;
  });
  check(dMatches.length >= 2, "when a round ends, its code is checked automatically (and matches both earlier copies)");
  const leaked = await recruiter.req("GET", "/app/code-similarity?status=all");
  check(leaked.text.includes("likely leaked"), "three candidates with near-identical code mark the problem as likely leaked");

  /* ------------------------------ Known solutions ------------------------------ */
  check((await recruiter.req("POST", "/api/code-similarity/references", { problemId: PROBLEM, language: "python", source: "forum", code: published })).status === 403, "only admins add known solutions");
  check((await admin.req("POST", "/api/code-similarity/references", { problemId: PROBLEM, language: "python", source: "forum", code: "print(input()) # too short to tell" })).status === 400, "a snippet too short to compare is refused");
  check((await admin.req("POST", "/api/code-similarity/references", { problemId: "no-such-problem", language: "python", source: "forum", code: published })).status === 404, "known solutions must be for a real problem");
  const ref = await admin.json<{ id: string; matches: number; checked: number }>("POST", "/api/code-similarity/references", { problemId: PROBLEM, language: "python", source: `https://forum.example.com/two-sum-${stamp}`, code: published });
  check(ref.checked >= 4 && ref.matches >= 1, `a known solution is compared with past submissions (${ref.matches} match of ${ref.checked})`);
  const cRef = await q("select 1 from code_matches m join code_fingerprints f on f.id = m.a_id where m.reference_id = $1 and f.candidacy_id = $2", [ref.id, people.c.cid]);
  check(cRef.length === 1, "the candidate whose code matches the published solution is flagged");
  const refMatch = await q<{ id: string }>("select id from code_matches where reference_id = $1 limit 1", [ref.id]);
  const refPage = await recruiter.req("GET", `/app/code-similarity/${refMatch[0].id}`);
  check(refPage.text.includes("Known solution: https://forum.example.com"), "a match with a known solution shows where it was found");

  /* ------------------------------ Retire a problem ------------------------------ */
  check((await recruiter.req("POST", `/api/code-similarity/problems/${PROBLEM}`, { retired: true })).status === 403, "only admins retire problems");
  await admin.json("POST", `/api/code-similarity/problems/${PROBLEM}`, { retired: true });
  const s1 = await admin.json<{ retiredProblems: string[] }>("PUT", "/api/settings", {});
  check(s1.retiredProblems.includes(PROBLEM), "an admin can retire a problem from new interviews");
  check((await admin.req("GET", "/app/code-similarity?status=all")).text.includes("retired"), "retired problems are marked");
  await admin.json("POST", `/api/code-similarity/problems/${PROBLEM}`, { retired: false });
  const s2 = await admin.json<{ retiredProblems: string[] }>("PUT", "/api/settings", {});
  check(!s2.retiredProblems.includes(PROBLEM), "and bring it back");

  /* ------------------------------ Data and isolation ------------------------------ */
  const [fk] = await q<{ delete_rule: string }>("select delete_rule from information_schema.referential_constraints where constraint_name = 'code_fingerprints_candidacy_id_candidacies_id_fk'");
  check(fk?.delete_rule === "CASCADE", "fingerprints and matches are deleted with the candidate's data");
  const otherEmail = `code-iso.${stamp}@iso.test`;
  await admin.json("POST", "/api/platform/orgs", { name: `Code Iso ${stamp}`, admin: { name: "Ola Admin", email: otherEmail, password: pw } });
  const other = await new Client().login(otherEmail, pw);
  check((await other.req("GET", `/app/code-similarity/${ab!.id}`)).status === 404, "another organisation can't open this organisation's matches");
  check((await other.req("POST", `/api/code-similarity/matches/${ab!.id}`, { status: "open" })).status === 404, "another organisation can't review them");
  check((await other.req("DELETE", `/api/code-similarity/references/${ref.id}`)).status === 404, "another organisation can't remove this organisation's known solutions");
  check(!(await other.req("GET", "/app/code-similarity?status=all")).text.includes(people.a.name), "another organisation sees none of these matches");
  const acts = (await q<{ action: string }>("select distinct action from audit_log where org_id = $1 and action like 'code.%'", [orgId])).map((a) => a.action);
  check(["code.scan", "code.match_found", "code.match_review", "code.reference_add", "code.problem_retire", "code.problem_restore"].every((a) => acts.includes(a)), "checks, reviews, known solutions and retiring are audited");
}

main().catch((e) => {
  console.error("\nPHASE 16 CHECKS FAILED:", e);
  process.exit(1);
});
