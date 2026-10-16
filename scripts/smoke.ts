/**
 * End-to-end smoke test of the full multi-round pipeline over HTTP.
 * Run against a server started with AI_MOCK=true GITHUB_MOCK=true CODE_EXECUTOR=local-dev:
 *   BASE_URL=http://localhost:3000 npx tsx scripts/smoke.ts
 */
import "./load-env";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
let cookie = "";

function log(...a: unknown[]) {
  console.log("•", ...a);
}

async function call<T = Record<string, unknown>>(method: string, path: string, body?: unknown, form?: FormData): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  return data as T;
}

async function turn(base: string, kind: string, text: string) {
  const res = await fetch(`${BASE}${base}/turns`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientMsgId: crypto.randomUUID(), kind, text }),
  });
  const raw = await res.text();
  const events = raw
    .split("\n\n")
    .map((c) => {
      const type = /event: (\w+)/.exec(c)?.[1];
      const data = /data: (.*)/.exec(c)?.[1];
      return type && data ? { type, data: JSON.parse(data) } : null;
    })
    .filter(Boolean) as { type: string; data: Record<string, unknown> }[];
  const err = events.find((e) => e.type === "error");
  if (err) throw new Error(`turn error: ${JSON.stringify(err.data)}`);
  const ai = events.filter((e) => e.type === "token").map((e) => e.data.text).join("");
  const ws = [...events].reverse().find((e) => e.type === "workspace")?.data.workspace as { kind: string; sectionKey?: string; problem?: { id: string } } | undefined;
  const done = events.find((e) => e.type === "done")?.data as { ended: boolean } | undefined;
  const state = [...events].reverse().find((e) => e.type === "state")?.data.state as { current: number; sections: { key: string }[] } | undefined;
  return { ai, ws, ended: !!done?.ended, section: state?.sections[state.current]?.key };
}

/** Build a minimal valid single-page PDF containing the given lines of text. */
function makePdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (m) => `\\${m}`);
  const content = `BT /F1 10 Tf 50 780 Td 14 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(" ")} ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

const LONG = (topic: string) =>
  `On ${topic}, I personally designed the approach after comparing two alternatives. I chose the second because it reduced latency by 35 percent and simplified operations. I measured the impact with dashboards over four weeks, ran a load test at twice peak traffic, and documented the trade-offs. In hindsight I would add better alerting earlier, because we caught one regression late. The team adopted the pattern for two other services afterwards.`;

async function waitFor<T>(label: string, fn: () => Promise<T | null | undefined | false>, timeoutMs = 60_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const PY_SOLUTIONS: Record<string, string> = {
  "two-sum": `import sys\nd=sys.stdin.read().split("\\n");n,t=map(int,d[0].split());a=list(map(int,d[1].split()));s={}\nfor j,x in enumerate(a):\n    if t-x in s: print(s[t-x],j); break\n    s.setdefault(x,j)\nelse: print(-1,-1)\n`,
};

async function runRound(token: string, index: number, candidacyId: string) {
  const { sessionId } = await call<{ sessionId: string }>("POST", `/api/c/${token}/rounds/${index}/start`, { mode: "text" });
  const base = `/api/c/${token}/sessions/${sessionId}`;
  let r = await turn(base, "open", "");
  log(`round ${index} opened:`, r.ai.slice(0, 90));
  for (let i = 0; i < 60 && !r.ended; i++) {
    if (r.ws?.kind === "coding" && r.ws.problem && !(r.ws as { submitted?: boolean }).submitted) {
      const code = PY_SOLUTIONS[r.ws.problem.id] ?? "import sys\nprint(sys.stdin.read().strip().split('\\n')[0])\n";
      const run = await call<{ results: { passed: number; total: number } }>("POST", `${base}/code`, { action: "run", language: "python", code });
      await new Promise((res) => setTimeout(res, 3100));
      const sub = await call<{ results: { passed: number; total: number } }>("POST", `${base}/code`, { action: "submit", language: "python", code });
      log(`  coding ${r.ws.problem.id}: samples ${run.results.passed}/${run.results.total}, hidden ${sub.results.passed}/${sub.results.total}`);
      r = await turn(base, "submitted", "I've submitted my solution.");
      continue;
    }
    if (r.ws && ["system_design", "domain_case", "mgmt_case"].includes(r.ws.kind) && !(r.ws as { submitted?: boolean }).submitted) {
      const tpl = (r.ws as unknown as { template: { key: string }[] }).template;
      await call("PUT", `${base}/exercise`, { content: Object.fromEntries(tpl.map((t) => [t.key, LONG(t.key)])) });
      log(`  ${r.ws.kind} written + submitted`);
      r = await turn(base, "submitted", "I've submitted my written response.");
      continue;
    }
    if (r.ws?.kind === "practical_fit" && !(r.ws as { submitted?: boolean }).submitted) {
      await call("PUT", `${base}/practical-fit`, {
        data: { currentLocation: "Pune", willingToRelocate: "yes", workModel: "hybrid", noticeDays: 45, noticeNegotiable: true, servingNotice: false, earliestJoiningDate: "2026-12-01", expectedCompMin: null, expectedCompMax: null, compCurrency: "INR", compPreferLater: false, otherOffers: "" },
      });
      log("  practical fit confirmed");
      r = await turn(base, "submitted", "I've confirmed my details in the form.");
      continue;
    }
    r = await turn(base, "answer", LONG(r.section ?? "this"));
  }
  if (!r.ended) throw new Error(`round ${index} did not end`);
  log(`round ${index} ended`);
  // Integrity events and state reload sanity
  const st = await call<{ state: { ended: boolean } }>("GET", `${base}/state`);
  if (!st.state.ended) throw new Error("state not ended");
  return sessionId;
}

async function main() {
  await call("POST", "/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  log("staff login ok");
  const jd = `We are hiring a Senior Backend Engineer for our fintech payments platform. You will design and own Node.js and TypeScript services backed by PostgreSQL and Redis, running on AWS with Docker and Kubernetes.
Responsibilities: design REST APIs and event-driven microservices with Kafka; lead design reviews and mentor 2-3 engineers; own reliability, observability and performance of payment flows.
Requirements: 5-8 years of backend experience, strong system design, SQL, testing and CI/CD practices.`;
  const { id: driveId } = await call<{ id: string }>("POST", "/api/drives", { title: "Senior Backend Engineer", jdText: jd });
  log("drive created", driveId);
  await call("POST", `/api/drives/${driveId}/publish`, {});
  log("drive published");
  const inv = await call<{ results: { link: string; status: string }[] }>("POST", `/api/drives/${driveId}/invites`, { candidates: [{ name: "Asha Verma", email: `asha.${Date.now()}@example.com` }] });
  const token = inv.results[0].link.split("/c/")[1];
  log("candidate invited");

  await call("POST", `/api/c/${token}/consent`, { accept: true });
  const pdf = makePdf([
    "Asha Verma",
    "asha@example.com | github.com/ashav",
    "Senior Software Engineer with 6 years building Node.js, TypeScript, PostgreSQL and Redis services on AWS.",
    "Experience",
    "Senior Engineer, PayCo (2021-present): Reduced p99 latency from 800ms to 120ms by introducing Redis caching.",
    "Led a team of 4 engineers to build an event-driven ledger using Kafka handling 2M events per day.",
    "Engineer, ShopCo (2018-2021): Built REST APIs in Node.js; promoted twice in 3 years.",
    "Projects",
    "Orders Service: an order management API in TypeScript with PostgreSQL and Docker",
    "Skills: Node.js, TypeScript, PostgreSQL, Redis, Kafka, AWS, Docker, Kubernetes, System design, Testing",
  ]);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), "resume.pdf");
  await call("POST", `/api/c/${token}/resume`, undefined, form);
  const parsed = await waitFor("resume parse", async () => {
    const r = await call<{ status: string; profile: Record<string, unknown>; error?: string }>("GET", `/api/c/${token}/resume`);
    if (r.status === "failed") throw new Error(`resume failed: ${r.error}`);
    return r.status === "parsed" ? r : null;
  });
  const profile = parsed.profile as { projects: { name: string }[]; experience: unknown[] };
  log("resume parsed; projects:", profile.projects.map((p) => p.name).join(", ") || "(none)");
  if (!profile.projects.length) profile.projects.push({ name: "Orders Service", description: "Order API", techStack: ["TypeScript"], role: "", links: [] } as never);
  await call("PUT", `/api/c/${token}/resume`, { profile });
  log("profile confirmed");
  await call("POST", `/api/c/${token}/repos`, { githubUsername: "ashav", projects: [{ projectName: profile.projects[0].name, url: "https://github.com/ashav/orders-service", notPublicReason: null }] });
  await waitFor("repo analysis", async () => {
    const r = await call<{ repos: { status: string; error?: string }[] }>("GET", `/api/c/${token}/repos`);
    if (r.repos[0].status === "failed") throw new Error(`repo failed: ${r.repos[0].error}`);
    return r.repos[0].status === "ready";
  });
  log("repo analysed");

  const cand = await call<{ results: unknown }>("GET", `/api/c/${token}/resume`); // keep session warm
  void cand;
  let candidacyId = "";
  for (let i = 0; i < 3; i++) {
    await runRound(token, i, candidacyId);
    if (i < 2) {
      // Staged mode: wait for evaluation + auto gate (mock scores are high enough to auto-advance).
      await waitFor(`round ${i} evaluation + gate`, async () => {
        const html = await fetch(`${BASE}/c/${token}`).then((x) => x.text());
        return html.includes("Available now") || html.includes("Awaiting") ? true : null;
      }, 90_000);
      log(`round ${i} evaluated; next round available`);
    }
  }
  // Wait for the combined report.
  await waitFor("combined report", async () => {
    const html = await fetch(`${BASE}/c/${token}`).then((x) => x.text());
    return html.includes("completed your interview");
  }, 90_000);
  log("candidate sees completion");
  console.log("\nSMOKE TEST PASSED");
}

main().catch((e) => {
  console.error("\nSMOKE TEST FAILED:", e);
  process.exit(1);
});
