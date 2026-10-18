/**
 * Phase 13 screenshots: the practice offer on the candidate hub, the practice lobby, a practice run in the room,
 * the practice end screen, and what staff see (only that the candidate practised).
 *   OUT=./screens npx tsx e2e/ui-phase13.ts
 */
import "../scripts/load-env";
import { chromium, type Page } from "@playwright/test";
import fs from "node:fs";
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT ?? "screens";
fs.mkdirSync(OUT, { recursive: true });
const errors: string[] = [];

async function shot(page: Page, name: string, selector?: string) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  if (selector) await page.locator(selector).first().screenshot({ path: `${OUT}/${name}.png`, caret: "initial" });
  else await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true, caret: "initial" });
  console.log("📸", name);
}

async function main() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const q = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows as T[];
  const [{ org_id: orgId }] = await q<{ org_id: string }>("select org_id from users where email = $1", [process.env.ADMIN_EMAIL!.toLowerCase()]);
  const [drive] = await q<{ id: string }>("select id from drives where org_id = $1 and status = 'active' order by created_at desc limit 1", [orgId]);

  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !/monaco|cdn|Failed to load resource/i.test(m.text()) && errors.push(`console: ${m.text()}`));
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState("networkidle");
  await page.fill('input[type="email"]', process.env.ADMIN_EMAIL!);
  await page.fill('input[type="password"]', process.env.ADMIN_PASSWORD!);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/app`);
  await page.request.put(`${BASE}/api/settings`, { data: { practiceEnabled: true }, headers: { origin: BASE } });
  const inv = await page.request.post(`${BASE}/api/drives/${drive.id}/invites`, { data: { candidates: [{ name: "Mira Practice", email: `mira.${Date.now()}@example.com` }] }, headers: { origin: BASE } });
  const token = ((await inv.json()) as { results: { link: string }[] }).results[0].link.split("/c/")[1];
  const [{ id: cid }] = await q<{ id: string }>("select id from candidacies where access_token = $1", [token]);

  const cand = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
  cand.on("pageerror", (e) => errors.push(`candidate pageerror: ${e.message}`));
  await cand.request.post(`${BASE}/api/c/${token}/consent`, { data: { accept: true }, headers: { origin: BASE } });
  // Skip onboarding (covered elsewhere): the candidate is ready for round 1.
  await q("update candidacies set stage = 'ready', current_round_index = 0 where id = $1", [cid]);
  await cand.goto(`${BASE}/c/${token}`);
  await cand.waitForSelector("text=Try a practice");
  await shot(cand, "130-practice-offer");
  await cand.click("text=Try a practice");
  await cand.waitForSelector("text=Practice interview (not scored)");
  await shot(cand, "131-practice-lobby");
  await cand.click('button:has-text("Start practice")');
  await cand.waitForSelector("text=short practice interview", { timeout: 30_000 });
  const answers = [
    "I enjoy turning messy problems into simple, reliable services that people can depend on.",
    "Last quarter our checkout page was slow. I profiled it, found an N+1 query, batched it and added an index — p95 went from 2.1s to 400ms.",
    "We considered caching too, but the query fix was simpler and removed the root cause.",
  ];
  const done = cand.getByText("Practice complete");
  const box = cand.locator("textarea:not([disabled])");
  for (let i = 0; i < 10; i++) {
    // Wait for the interviewer to finish speaking: either the answer box is ready again or the practice is over.
    await box.or(done).first().waitFor({ timeout: 30_000 });
    if (await done.count()) break;
    if (i === 2) await shot(cand, "132-practice-room");
    await box.fill(answers[i % answers.length]);
    await cand.click('button:has-text("Send")');
    await cand.waitForTimeout(300);
  }
  await cand.waitForSelector("text=Practice complete", { timeout: 30_000 });
  await shot(cand, "133-practice-complete");

  await page.goto(`${BASE}/app/candidates/${cid}`);
  await page.waitForSelector("text=practice taken");
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.screenshot({ path: `${OUT}/134-staff-practice-note.png`, clip: { x: 0, y: 0, width: 1440, height: 260 }, caret: "initial" });
  console.log("📸", "134-staff-practice-note");
  await browser.close();
  await db.end();
  if (errors.length) {
    console.error("UI errors:\n" + errors.join("\n"));
    process.exit(1);
  }
  console.log("\nPHASE 13 UI CHECK PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
