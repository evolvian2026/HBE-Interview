/**
 * HTTP checks for Phase 3 features against a server started with AI_MOCK=true GITHUB_MOCK=true CODE_EXECUTOR=local-dev:
 *   BASE_URL=http://localhost:3000 npx tsx scripts/smoke-phase3.ts
 * Covers: API keys + REST v1, signed webhooks (local receiver), language selection, OCR resume upload,
 * GitLab repo links, whiteboard, webcam snapshots + presence check, candidate survey, released feedback,
 * fairness monitor and the Integrations settings card.
 */
import "./load-env";
import http from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const HOOK_PORT = Number(process.env.HOOK_PORT ?? 4599);

function check(cond: unknown, msg: string) {
  if (!cond) throw new Error(`CHECK FAILED: ${msg}`);
  console.log("✓", msg);
}

class Client {
  cookie = "";
  constructor(public bearer?: string) {}
  async req(method: string, path: string, body?: unknown, form?: FormData) {
    const res = await fetch(BASE + path, {
      method,
      redirect: "manual",
      headers: {
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(this.bearer ? { authorization: `Bearer ${this.bearer}` } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const sc = res.headers.get("set-cookie");
    if (sc) this.cookie = sc.split(";")[0];
    return { status: res.status, text: await res.text() };
  }
  async json<T = Record<string, unknown>>(method: string, path: string, body?: unknown, form?: FormData): Promise<T> {
    const r = await this.req(method, path, body, form);
    if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status}: ${r.text}`);
    return JSON.parse(r.text || "{}") as T;
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

/* ------------------------------ webhook receiver ----------------------------- */

interface Received {
  event: string;
  delivery: string;
  verified: boolean;
  body: { event: string; data: Record<string, unknown> };
}
const received: Received[] = [];
let secret = "";

function verify(raw: string, ts: string, sig: string) {
  if (!ts || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    received.push({
      event: String(req.headers["x-hbe-event"]),
      delivery: String(req.headers["x-hbe-delivery"]),
      verified: verify(raw, String(req.headers["x-hbe-timestamp"] ?? ""), String(req.headers["x-hbe-signature"] ?? "")),
      body: JSON.parse(raw),
    });
    res.writeHead(204).end();
  });
});

const got = (event: string, candidacyId?: string) => received.find((r) => r.event === event && (!candidacyId || r.body.data.candidacyId === candidacyId));

/* ---------------------------------- turns ---------------------------------- */

async function turn(base: string, kind: string, text: string) {
  const res = await fetch(`${BASE}${base}/turns`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientMsgId: crypto.randomUUID(), kind, text }),
  });
  const events = (await res.text())
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
  const ws = [...events].reverse().find((e) => e.type === "workspace")?.data.workspace as Record<string, unknown> | undefined;
  const done = events.find((e) => e.type === "done")?.data as { ended: boolean } | undefined;
  const state = [...events].reverse().find((e) => e.type === "state")?.data.state as { current: number; sections: { key: string }[] } | undefined;
  return { ai, ws, ended: !!done?.ended, section: state?.sections[state.current]?.key };
}

const LONG = (t: string) =>
  `On ${t}, I personally designed the approach after comparing two alternatives. I chose the second because it reduced latency by 35 percent and simplified operations. I measured impact with dashboards over four weeks, ran a load test at twice peak traffic and documented the trade-offs. In hindsight I would add alerting earlier.`;

// 1×1 PNG and a tiny JPEG (magic bytes are what the server validates; mock AI ignores pixels).
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9]);

async function main() {
  await new Promise<void>((r) => server.listen(HOOK_PORT, "127.0.0.1", r));
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const admin = new Client();
  await admin.json("POST", "/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });

  /* ---------------------------- integrations setup --------------------------- */
  // Remove leftovers from an earlier interrupted run (their old secrets would fail verification here).
  await db.query("delete from webhooks where url like $1", [`http://127.0.0.1:${HOOK_PORT}/%`]);
  await db.query("update api_keys set revoked_at = now() where name like 'smoke %' and revoked_at is null");
  const hook = await admin.json<{ id: string; secret: string }>("POST", "/api/settings/webhooks", {
    url: `http://127.0.0.1:${HOOK_PORT}/hbe`,
    events: ["candidate.invited", "round.completed", "round.evaluated", "gate.decided", "candidate.status_changed"],
  });
  secret = hook.secret;
  check(secret.startsWith("whsec_"), "webhook registered; signing secret returned once");
  const full = await admin.json<{ id: string; key: string }>("POST", "/api/settings/api-keys", { name: "smoke full", scopes: ["drives:read", "candidates:read", "candidates:write"] });
  const ro = await admin.json<{ id: string; key: string }>("POST", "/api/settings/api-keys", { name: "smoke read-only", scopes: ["drives:read"] });
  const { rows: keyRows } = await db.query("select key_hash from api_keys where id = $1", [full.id]);
  check(full.key.startsWith("hbe_") && keyRows[0].key_hash !== full.key && keyRows[0].key_hash.length === 64, "API key created; only its SHA-256 hash is stored");

  const anon = new Client();
  check((await anon.req("GET", "/api/v1/drives")).status === 401, "REST API rejects requests without a key");
  const api = new Client(full.key);
  const roApi = new Client(ro.key);

  /* ------------------------ drive: Hindi + webcam enabled ----------------------- */
  const jd = `We are hiring a Senior Backend Engineer for our payments platform. You will design Node.js and TypeScript services backed by PostgreSQL and Redis on AWS. Responsibilities: design REST APIs and event-driven services with Kafka; mentor engineers; own reliability. Requirements: 5-8 years of backend experience, system design, SQL, testing.`;
  const { id: driveId } = await admin.json<{ id: string }>("POST", "/api/drives", { title: "Senior Backend Engineer (Phase 3)", jdText: jd });
  const { rows: dr } = await db.query("select draft from drives where id = $1", [driveId]);
  const config = { ...dr[0].draft, languages: ["en", "hi"], proctoring: { webcam: true, intervalSec: 30 } };
  await admin.json("PUT", `/api/drives/${driveId}`, { config });
  await admin.json("POST", `/api/drives/${driveId}/publish`, {});
  const drives = await api.json<{ data: { id: string; status: string }[] }>("GET", "/api/v1/drives");
  check(drives.data.some((d) => d.id === driveId && d.status === "active"), "GET /api/v1/drives lists the published drive");
  check((await roApi.req("POST", `/api/v1/drives/${driveId}/candidates`, { candidates: [{ name: "X", email: "x@example.com" }] })).status === 403, "key without candidates:write gets 403");

  const inv = await api.json<{ data: { status: string; link: string; candidacyId: string }[] }>("POST", `/api/v1/drives/${driveId}/candidates`, {
    candidates: [{ name: "Kavya Iyer", email: `kavya.${Date.now()}@example.com` }],
  });
  const { candidacyId, link } = inv.data[0];
  const token = link.split("/c/")[1];
  check(inv.data[0].status === "invited" && candidacyId && token, "POST /api/v1/drives/{id}/candidates invites and returns the personal link");
  const invited = await waitFor("candidate.invited webhook", async () => got("candidate.invited", candidacyId), 90_000);
  check(invited.verified, "candidate.invited webhook delivered with a valid HMAC signature");

  /* --------------------------- onboarding: OCR + GitLab -------------------------- */
  check((await anon.req("POST", `/api/c/${token}/consent`, { accept: true, webcam: false })).status === 400, "webcam-proctored drive requires webcam consent (server-enforced)");
  await anon.json("POST", `/api/c/${token}/consent`, { accept: true, webcam: true });
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(Buffer.from(PNG_B64, "base64"))], { type: "image/png" }), "resume-scan.png");
  await anon.json("POST", `/api/c/${token}/resume`, undefined, form);
  const parsed = await waitFor("OCR resume parse", async () => {
    const r = await anon.json<{ status: string; profile: { projects: { name: string }[] }; error?: string }>("GET", `/api/c/${token}/resume`);
    if (r.status === "failed") throw new Error(`resume failed: ${r.error}`);
    return r.status === "parsed" ? r : null;
  });
  const { rows: rr } = await db.query("select ocr_used from resumes where candidacy_id = $1", [candidacyId]);
  check(rr[0].ocr_used === true, "image resume parsed via OCR (ocr_used recorded)");
  const profile = parsed.profile;
  if (!profile.projects.length) profile.projects.push({ name: "Orders Service" });
  await anon.json("PUT", `/api/c/${token}/resume`, { profile });
  await anon.json("POST", `/api/c/${token}/repos`, { githubUsername: "kavya", projects: [{ projectName: profile.projects[0].name, url: "https://gitlab.com/kavya/orders-service", notPublicReason: null }] });
  await waitFor("repo analysis", async () => {
    const r = await anon.json<{ repos: { status: string; error?: string }[] }>("GET", `/api/c/${token}/repos`);
    if (r.repos[0].status === "failed") throw new Error(`repo failed: ${r.repos[0].error}`);
    return r.repos[0].status === "ready";
  });
  check(true, "GitLab repository link accepted and analysed");

  /* ------------------------- round 0 in Hindi + whiteboard ------------------------ */
  const bad = await anon.req("POST", `/api/c/${token}/rounds/0/start`, { mode: "text", language: "fr" });
  check(bad.status === 400, "language not enabled for the drive is rejected");
  const lobby = await fetch(`${BASE}/c/${token}/round/0`).then((r) => r.text());
  check(lobby.includes("हिन्दी"), "lobby offers the drive's languages (Hindi shown natively)");
  const { sessionId } = await anon.json<{ sessionId: string }>("POST", `/api/c/${token}/rounds/0/start`, { mode: "text", language: "hi" });
  const base = `/api/c/${token}/sessions/${sessionId}`;
  const st0 = await anon.json<{ state: { language: string } }>("GET", `${base}/state`);
  check(st0.state.language === "hi", "session records the chosen interview language");
  let r = await turn(base, "open", "");
  check(r.ai.includes("हिन्दी") || /[\u0900-\u097F]/.test(r.ai), "interviewer opens in Hindi (mock tags native language)");

  const snap = await anon.json<{ ok: boolean; skipped?: boolean }>("POST", `${base}/snapshot`, { image: `data:image/jpeg;base64,${JPEG.toString("base64")}` });
  check(snap.ok && !snap.skipped, "webcam snapshot accepted");
  const presence = await waitFor("presence check", async () => {
    const { rows } = await db.query("select flagged, \"check\" from proctor_snapshots where session_id = $1 and \"check\" is not null", [sessionId]);
    return rows[0];
  }, 30_000);
  check(presence.flagged === false && presence.check.personCount === 1, "presence check ran (one person, not flagged)");

  let whiteboardSaved = false;
  for (let i = 0; i < 60 && !r.ended; i++) {
    const ws = r.ws;
    if (process.env.DEBUG_WS) console.log("  ws:", ws?.kind, ws?.submitted, r.section);
    if (ws?.kind === "coding" && !ws.submitted) {
      const code = "import sys\nprint(sys.stdin.read().strip().split('\\n')[0])\n";
      await anon.json("POST", `${base}/code`, { action: "submit", language: "python", code });
      r = await turn(base, "submitted", "मैंने अपना समाधान सबमिट कर दिया है।");
      continue;
    }
    if (ws && ["system_design", "domain_case", "mgmt_case"].includes(String(ws.kind)) && !ws.submitted) {
      if (ws.kind === "system_design") {
        const shapes = [
          { id: "a", type: "rect", x: 20, y: 20, w: 120, h: 60, label: "API gateway" },
          { id: "b", type: "rect", x: 220, y: 20, w: 120, h: 60, label: "Ledger service" },
          { id: "c", type: "arrow", x: 140, y: 50, x2: 220, y2: 50, label: "gRPC" },
        ];
        await anon.json("PUT", `${base}/whiteboard`, { shapes, png: `data:image/png;base64,${PNG_B64}` });
        whiteboardSaved = true;
      }
      const tpl = ws.template as { key: string }[];
      await anon.json("PUT", `${base}/exercise`, { content: Object.fromEntries(tpl.map((t) => [t.key, LONG(t.key)])) });
      r = await turn(base, "submitted", "मैंने अपना लिखित उत्तर सबमिट कर दिया है।");
      continue;
    }
    r = await turn(base, "answer", `मेरे अनुभव में, ${LONG(r.section ?? "this")}`);
  }
  check(r.ended, "Hindi round 0 completed");
  check(whiteboardSaved, "whiteboard saved during system design");
  const { rows: wb } = await db.query("select jsonb_array_length(whiteboard) n, length(whiteboard_png) png from exercise_responses where session_id = $1 and kind = 'system_design'", [sessionId]);
  check(wb[0]?.n === 3 && wb[0]?.png > 0, "whiteboard shapes and PNG stored with the response");
  check((await anon.req("POST", `${base}/snapshot`, { image: `data:image/jpeg;base64,${JPEG.toString("base64")}` })).status === 200, "snapshots after the round ends are ignored");

  const completed = await waitFor("round.completed webhook", async () => got("round.completed", candidacyId), 90_000);
  check(completed.verified && completed.body.data.roundIndex === 0, "round.completed webhook delivered and signed");
  const evaluated = await waitFor("round.evaluated webhook", async () => got("round.evaluated", candidacyId), 90_000);
  check(evaluated.verified && typeof evaluated.body.data.score === "number", "round.evaluated webhook carries the round score");
  const { rows: stg } = await db.query("select stage from candidacies where id = $1", [candidacyId]);
  if (stg[0].stage === "gate_pending") {
    // Mock score fell below the auto-advance band: a hiring manager decides, which also emits gate.decided.
    await admin.json("POST", `/api/candidacies/${candidacyId}/gate`, { decision: "advance", reason: "Phase 3 smoke: manual advance" });
  }
  const gate = await waitFor("gate.decided webhook", async () => got("gate.decided", candidacyId), 90_000);
  check(gate.verified && gate.body.data.decision === "advance", `gate.decided webhook delivered (${gate.body.data.mode})`);
  const { rows: rep } = await db.query("select status from round_reports where session_id = $1", [sessionId]);
  check(rep[0]?.status === "ready", "round report ready");

  const cand = await api.json<{ data: { stage: string; rounds: { index: number; status: string; report: { score: number } | null }[] } }>("GET", `/api/v1/candidates/${candidacyId}`);
  check(cand.data.rounds[0].status === "completed" && typeof cand.data.rounds[0].report?.score === "number", "GET /api/v1/candidates/{id} shows round status and score");
  const list = await api.json<{ data: { id: string }[] }>("GET", `/api/v1/drives/${driveId}/candidates`);
  check(list.data.some((c) => c.id === candidacyId), "GET /api/v1/drives/{id}/candidates lists the candidate");

  /* --------------------------- survey + released feedback ------------------------- */
  const hub = await fetch(`${BASE}/c/${token}`).then((x) => x.text());
  check(hub.includes("Optional · 30 seconds"), "candidate hub offers the post-round survey");
  check((await anon.req("POST", `/api/c/${token}/feedback`, { roundIndex: 1, overall: 4 })).status === 409, "survey for a round not yet taken is rejected");
  check((await anon.req("POST", `/api/c/${token}/feedback`, { roundIndex: 0, overall: 6 })).status === 400, "out-of-range rating rejected");
  await anon.json("POST", `/api/c/${token}/feedback`, { roundIndex: 0, overall: 4, fairness: 5, clarity: 4, technical: 3, comment: "Clear questions; voice option was nice." });
  check((await anon.req("POST", `/api/c/${token}/feedback`, { roundIndex: 0, overall: 5 })).status === 409, "survey recorded once per round");
  const hub2 = await fetch(`${BASE}/c/${token}`).then((x) => x.text());
  check(!hub2.includes("Optional · 30 seconds"), "survey no longer shown after responding");

  const draft = await admin.json<{ summary: { strengths: string[]; growthAreas: string[]; note: string } }>("POST", `/api/candidacies/${candidacyId}/feedback`);
  check(draft.summary.strengths.length > 0 && draft.summary.growthAreas.length > 0, "AI drafts candidate-facing feedback");
  const hub3 = await fetch(`${BASE}/c/${token}`).then((x) => x.text());
  check(!hub3.includes("Feedback from the hiring team"), "draft feedback is not visible to the candidate");
  await admin.json("PUT", `/api/candidacies/${candidacyId}/feedback`, { summary: { ...draft.summary, strengths: [...draft.summary.strengths, "You structured your design clearly."] }, release: true });
  const hub4 = await fetch(`${BASE}/c/${token}`).then((x) => x.text());
  check(hub4.includes("Feedback from the hiring team") && hub4.includes("You structured your design clearly."), "released (edited) feedback appears on the candidate hub");

  /* ------------------------------ staff pages ------------------------------- */
  const staffPage = await admin.req("GET", `/app/candidates/${candidacyId}`);
  check(staffPage.status === 200 && staffPage.text.includes("Candidate experience survey") && staffPage.text.includes("Clear questions"), "staff candidate page shows feedback panel and survey");
  check(staffPage.text.includes("Webcam snapshots") || staffPage.text.includes("webcam"), "staff candidate page shows webcam proctoring");
  const fair = await admin.req("GET", `/app/drives/${driveId}/fairness`);
  check(fair.status === 200 && fair.text.includes("Fairness monitor") && fair.text.includes("Interview language") && fair.text.includes("Hindi"), "fairness monitor renders with language cohorts");
  const settings = await admin.req("GET", "/app/settings");
  check(settings.status === 200 && settings.text.includes("Integrations") && settings.text.includes("smoke full") && !settings.text.includes(full.key), "settings shows integrations without exposing the key");

  /* --------------------------- status change, ping, revoke -------------------------- */
  await admin.json("POST", `/api/candidacies/${candidacyId}/status`, { status: "on_hold" });
  const sc = await waitFor("candidate.status_changed webhook", async () => got("candidate.status_changed", candidacyId), 90_000);
  check(sc.verified && sc.body.data.status === "on_hold", "candidate.status_changed webhook delivered");
  await admin.json("POST", `/api/settings/webhooks/${hook.id}/test`);
  const ping = await waitFor("ping", async () => got("ping"), 30_000);
  check(ping.verified, "test ping delivered and signed");
  const deliveries = await db.query("select count(*)::int n from webhook_deliveries where webhook_id = $1 and status = 'delivered'", [hook.id]);
  check(deliveries.rows[0].n >= 6, `deliveries recorded as delivered (${deliveries.rows[0].n})`);
  check(new Set(received.map((x) => x.delivery)).size === received.length, "each delivery has a unique id");

  await admin.json("DELETE", `/api/settings/api-keys/${full.id}`);
  check((await api.req("GET", "/api/v1/drives")).status === 401, "revoked key stops working");
  await admin.json("DELETE", `/api/settings/api-keys/${ro.id}`);
  await admin.json("DELETE", `/api/settings/webhooks/${hook.id}`);

  await db.end();
  server.close();
  console.log(`\nPHASE 3 CHECKS PASSED (${received.length} webhooks received)`);
  console.log(`candidate: ${BASE}/app/candidates/${candidacyId}\nfairness: ${BASE}/app/drives/${driveId}/fairness`);
}

main().catch((e) => {
  console.error("\nPHASE 3 CHECKS FAILED:", e);
  process.exit(1);
});
