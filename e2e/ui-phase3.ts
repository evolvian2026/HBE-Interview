/**
 * Browser walkthrough of Phase 3 UI with screenshots (mock AI). Run after scripts/smoke-phase3.ts and pass the
 * IDs it prints:
 *   P3_DRIVE_ID=… P3_CANDIDACY_ID=… OUT=./screens npx tsx e2e/ui-phase3.ts
 */
import "../scripts/load-env";
import { chromium, type Page } from "@playwright/test";
import fs from "node:fs";
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT ?? "screens";
fs.mkdirSync(OUT, { recursive: true });
const errors: string[] = [];
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function shot(page: Page, name: string, selector?: string) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  if (selector) await page.locator(selector).first().screenshot({ path: `${OUT}/${name}.png`, caret: "initial" });
  else await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true, caret: "initial" });
  console.log("📸", name);
}

const card = (title: string) => `section:has(> div > h2:text-is("${title}"))`;

let cookie = "";
async function call<T = Record<string, unknown>>(method: string, path: string, body?: unknown, form?: FormData): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const sc = res.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  return (text ? JSON.parse(text) : {}) as T;
}

async function turn(base: string, kind: string, text: string) {
  const raw = await fetch(`${BASE}${base}/turns`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientMsgId: crypto.randomUUID(), kind, text }),
  }).then((r) => r.text());
  const ws = raw
    .split("\n\n")
    .filter((c) => c.includes("event: workspace"))
    .map((c) => JSON.parse(/data: (.*)/.exec(c)![1]).workspace)
    .pop() as { kind: string; submitted?: boolean } | undefined;
  return { ws };
}

async function waitFor<T>(label: string, fn: () => Promise<T | null | undefined | false>, timeoutMs = 60_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** Invite a fresh candidate and onboard them over HTTP (consent, OCR resume, Bitbucket repo). */
async function onboardCandidate(driveId: string) {
  const inv = await call<{ results: { link: string }[] }>("POST", `/api/drives/${driveId}/invites`, { candidates: [{ name: "Neha Joshi", email: `neha.${Date.now()}@example.com` }] });
  const token = inv.results[0].link.split("/c/")[1];
  const saved = cookie;
  cookie = "";
  await call("POST", `/api/c/${token}/consent`, { accept: true, webcam: true });
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(Buffer.from(PNG_B64, "base64"))], { type: "image/png" }), "scan.png");
  await call("POST", `/api/c/${token}/resume`, undefined, form);
  const parsed = await waitFor("parse", async () => {
    const r = await call<{ status: string; profile: { projects: { name: string }[] } }>("GET", `/api/c/${token}/resume`);
    return r.status === "parsed" ? r : null;
  });
  await call("PUT", `/api/c/${token}/resume`, { profile: parsed.profile });
  await call("POST", `/api/c/${token}/repos`, { githubUsername: "neha", projects: [{ projectName: parsed.profile.projects[0]?.name ?? "Orders Service", url: "https://bitbucket.org/neha/orders-service", notPublicReason: null }] });
  await waitFor("repo", async () => (await call<{ repos: { status: string }[] }>("GET", `/api/c/${token}/repos`)).repos[0].status === "ready");
  cookie = saved;
  return token;
}

/** Start round 0 over HTTP and answer until the system-design section opens. */
async function advanceToSystemDesign(token: string) {
  const { sessionId } = await call<{ sessionId: string }>("POST", `/api/c/${token}/rounds/0/start`, { mode: "text", language: "en" });
  const base = `/api/c/${token}/sessions/${sessionId}`;
  let r = await turn(base, "open", "");
  for (let i = 0; i < 40 && r.ws?.kind !== "system_design"; i++) {
    if (r.ws?.kind === "coding" && !r.ws.submitted) {
      await call("POST", `${base}/code`, { action: "submit", language: "python", code: "print(0)\n" });
      r = await turn(base, "submitted", "Submitted.");
      continue;
    }
    r = await turn(base, "answer", "I designed the order API, chose PostgreSQL for transactions and Redis for hot reads, and verified p99 latency with load tests before and after.");
  }
  if (r.ws?.kind !== "system_design") throw new Error("never reached system design");
}

async function main() {
  const driveId = process.env.P3_DRIVE_ID!;
  const candidacyId = process.env.P3_CANDIDACY_ID!;
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const { rows } = await db.query("select access_token from candidacies where id = $1", [candidacyId]);
  const token = rows[0].access_token as string;

  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  });

  /* --------------------------------- staff --------------------------------- */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !/monaco|cdn|Failed to load resource/i.test(m.text()) && errors.push(`console: ${m.text()}`));
  page.on("dialog", (d) => d.accept());
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState("networkidle"); // let the form hydrate (cold dev compiles)
  await page.fill('input[type="email"]', process.env.ADMIN_EMAIL!);
  await page.fill('input[type="password"]', process.env.ADMIN_PASSWORD!);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/app`);
  await call("POST", "/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });

  await page.goto(`${BASE}/app/settings`);
  await page.fill('input[placeholder^="Key name"]', "Greenhouse sync");
  await page.click("text=Create key");
  await page.waitForSelector("text=New API key");
  await page.fill('input[placeholder="https://example.com/hooks/hbe"]', "https://hooks.example.com/hbe");
  await page.click("text=Add webhook");
  await page.waitForSelector("text=Webhook signing secret");
  await shot(page, "30-settings-integrations", card("Integrations"));

  await page.goto(`${BASE}/app/drives/${driveId}/fairness`);
  await page.waitForSelector("text=Fairness monitor");
  await shot(page, "31-fairness");

  await page.goto(`${BASE}/app/candidates/${candidacyId}`);
  await page.waitForSelector("text=Candidate experience survey");
  await shot(page, "32-candidate-feedback-panel", card("Candidate feedback"));
  await shot(page, "33-candidate-page-full");

  /* -------------------------------- candidate ------------------------------- */
  const cctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["camera"] });
  const cpage = await cctx.newPage();
  cpage.on("pageerror", (e) => errors.push(`candidate pageerror: ${e.message}`));
  cpage.on("dialog", (d) => d.accept(d.message().startsWith("Arrow") ? "REST" : "Service"));
  await cpage.goto(`${BASE}/c/${token}`);
  await cpage.waitForSelector("text=Feedback from the hiring team");
  await shot(cpage, "34-candidate-hub-feedback");
  const wbToken = await onboardCandidate(driveId);
  await cpage.goto(`${BASE}/c/${wbToken}/round/0`);
  await cpage.waitForSelector("text=Interview language");
  await cpage.selectOption("select", "hi");
  await shot(cpage, "35-lobby-language");
  await advanceToSystemDesign(wbToken);
  await cpage.goto(`${BASE}/c/${wbToken}/round/0`);
  await cpage.waitForSelector("text=Whiteboard", { timeout: 30_000 });
  await cpage.click("button:has-text('Whiteboard')");
  const svg = cpage.locator('svg[aria-label="System design whiteboard"]');
  await svg.waitFor();
  const b = (await svg.boundingBox())!;
  const drag = async (x1: number, y1: number, x2: number, y2: number) => {
    await cpage.mouse.move(b.x + x1, b.y + y1);
    await cpage.mouse.down();
    await cpage.mouse.move(b.x + x2, b.y + y2, { steps: 5 });
    await cpage.mouse.up();
  };
  await drag(40, 40, 180, 100);
  await drag(300, 40, 440, 100);
  await drag(40, 200, 180, 260);
  await cpage.click("button:has-text('Arrow')");
  await drag(180, 70, 300, 70);
  await drag(110, 100, 110, 200);
  await cpage.waitForSelector("text=Saved · the interviewer can see this board", { timeout: 30_000 }); // debounced autosave
  await shot(cpage, "36-room-whiteboard");
  const { rows: wb } = await db.query(
    "select jsonb_array_length(e.whiteboard) n from exercise_responses e join round_sessions s on s.id = e.session_id join candidacies c on c.id = s.candidacy_id where c.access_token = $1 and e.kind = 'system_design'",
    [wbToken],
  );
  console.log(`whiteboard autosaved shapes: ${wb[0]?.n ?? 0}`);
  if (!(wb[0]?.n >= 5)) errors.push("whiteboard did not autosave all shapes");

  // Clean up the demo webhook so its failing deliveries don't keep retrying.
  await db.query("delete from webhooks where url = 'https://hooks.example.com/hbe'");
  await db.query("update api_keys set revoked_at = now() where name = 'Greenhouse sync' and revoked_at is null");
  await db.end();
  await browser.close();
  if (errors.length) {
    console.error("UI errors:\n" + errors.join("\n"));
    process.exit(1);
  }
  console.log("UI PHASE 3 CHECK PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
