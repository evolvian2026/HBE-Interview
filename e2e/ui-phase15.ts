/**
 * Phase 15 screenshots: the interviewer voice settings, and a voice-mode round with the natural voice — recording an
 * answer (simulated microphone), the transcript ready to edit, and the next question. Needs SPEECH_MOCK=true.
 *   OUT=./screens npx tsx e2e/ui-phase15.ts
 */
import "../scripts/load-env";
import { chromium, type Page } from "@playwright/test";
import fs from "node:fs";
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT ?? "screens";
fs.mkdirSync(OUT, { recursive: true });
const errors: string[] = [];

async function shot(page: Page, name: string, fullPage = true) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage, caret: "initial" });
  console.log("📸", name);
}

async function main() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const q = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows as T[];
  const [{ org_id: orgId }] = await q<{ org_id: string }>("select org_id from users where email = $1", [process.env.ADMIN_EMAIL!.toLowerCase()]);
  const [drive] = await q<{ id: string }>("select id from drives where org_id = $1 and status = 'active' order by created_at desc limit 1", [orgId]);

  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !/monaco|cdn|Failed to load resource/i.test(m.text()) && errors.push(`console: ${m.text()}`));
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState("networkidle");
  await page.fill('input[type="email"]', process.env.ADMIN_EMAIL!);
  await page.fill('input[type="password"]', process.env.ADMIN_PASSWORD!);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/app`);
  await page.request.put(`${BASE}/api/settings`, { data: { voice: { engine: "natural", accent: "en-IN", gender: "female" } }, headers: { origin: BASE } });
  await page.goto(`${BASE}/app/settings#voice`);
  await page.click('button:has-text("Play a sample")');
  await page.waitForSelector("text=Playing a sample");
  await page.addStyleTag({ content: "header{position:static !important}" });
  await page.locator("section#voice").screenshot({ path: `${OUT}/150-voice-settings.png`, caret: "initial" });
  console.log("📸", "150-voice-settings");

  const inv = await page.request.post(`${BASE}/api/drives/${drive.id}/invites`, { data: { candidates: [{ name: "Meera Speaks", email: `meera.${Date.now()}@example.com` }] }, headers: { origin: BASE } });
  const token = ((await inv.json()) as { results: { link: string }[] }).results[0].link.split("/c/")[1];
  const [{ id: cid }] = await q<{ id: string }>("select id from candidacies where access_token = $1", [token]);
  await q("update candidacies set stage = 'ready', current_round_index = 0 where id = $1", [cid]);

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, permissions: ["microphone"] });
  const cand = await ctx.newPage();
  cand.on("pageerror", (e) => errors.push(`candidate pageerror: ${e.message}`));
  await cand.goto(`${BASE}/c/${token}/round/0`);
  await cand.waitForSelector("text=Voice mode available (natural interviewer voice)");
  await cand.locator('input[name="mode"]').nth(1).check();
  await cand.waitForSelector("text=Voice is processed by our speech provider");
  await shot(cand, "151-voice-lobby");
  await cand.click('button:has-text("Start round")');
  await cand.waitForSelector("text=AI interviewer at", { timeout: 30_000 });
  await cand.waitForSelector('button:has-text("Speak"):not([disabled])', { timeout: 30_000 });
  await cand.click('button:has-text("Speak")');
  await cand.waitForSelector("text=Recording — speak naturally", { timeout: 10_000 });
  await cand.waitForTimeout(2500);
  await shot(cand, "152-recording-answer", false);
  await cand.click('button:has-text("Done speaking")');
  await cand.waitForFunction(() => (document.querySelector("textarea") as HTMLTextAreaElement | null)?.value.includes("mock transcript"), undefined, { timeout: 30_000 });
  await shot(cand, "153-transcript-to-edit", false);
  await cand.click('button:has-text("Send")');
  await cand.waitForFunction(() => document.querySelectorAll("[dir=auto]").length >= 3, undefined, { timeout: 30_000 });
  await cand.waitForSelector('button:has-text("Speak"):not([disabled])', { timeout: 30_000 });
  const spoken = await q<{ n: number }>("select count(*)::int n from speech_usage where org_id = $1 and created_at > now() - interval '2 minutes'", [orgId]);
  if (spoken[0].n < 3) errors.push(`expected natural voice and transcription calls, saw ${spoken[0].n}`);
  await shot(cand, "154-next-question", false);

  await browser.close();
  await db.end();
  if (errors.length) {
    console.error("UI errors:\n" + errors.join("\n"));
    process.exit(1);
  }
  console.log("\nPHASE 15 UI CHECK PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
