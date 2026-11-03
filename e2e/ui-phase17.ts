/**
 * Phase 17 screenshots: the hires list, a manager's 90-day check-in (blind, then with the interview results), and
 * the quality-of-hire page. Run after scripts/smoke-phase17.ts:  OUT=./screens npx tsx e2e/ui-phase17.ts
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
  const email = process.env.ADMIN_EMAIL!.toLowerCase();
  const [{ org_id: orgId, id: adminId }] = (await db.query("select org_id, id from users where email = $1", [email])).rows;
  // A joined hire whose 90-day check-in is due, reviewed by the admin for this walkthrough.
  const [h] = (
    await db.query(
      "select h.id from hires h where h.org_id = $1 and h.status = 'offered' and h.candidacy_id is not null order by h.created_at desc limit 1",
      [orgId],
    )
  ).rows as { id: string }[];
  if (!h) throw new Error("Run scripts/smoke-phase17.ts first (needs an open offer)");
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (x) => x.type() === "error" && !/monaco|cdn|Failed to load resource/i.test(x.text()) && errors.push(`console: ${x.text()}`));
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState("networkidle");
  await page.fill('input[type="email"]', process.env.ADMIN_EMAIL!);
  await page.fill('input[type="password"]', process.env.ADMIN_PASSWORD!);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/app`);

  // Record joining in the browser: 95 days ago, the admin as manager.
  const joined = new Date(Date.now() - 95 * 86_400_000).toISOString().slice(0, 10);
  const r = await page.request.post(`${BASE}/api/hires/${h.id}`, { data: { action: "joined", joinedAt: joined, managerId: adminId }, headers: { origin: BASE } });
  if (!r.ok()) throw new Error(`joined failed: ${await r.text()}`);
  await page.goto(`${BASE}/app/hires`);
  await page.waitForSelector("h1:has-text(\"Hires\")");
  await shot(page, "170-hires");

  const [rev] = (await db.query("select id from hire_reviews where hire_id = $1 and checkpoint = 90", [h.id])).rows as { id: string }[];
  await page.goto(`${BASE}/app/hires/review/${rev.id}`);
  await page.waitForSelector("text=Shown after you submit");
  await page.locator('[role="radiogroup"]').nth(0).locator("label").nth(3).click();
  await page.locator('[role="radiogroup"]').nth(1).locator("label").nth(4).click();
  await page.locator('[role="radiogroup"]').nth(2).locator("label").nth(3).click();
  await page.getByLabel("Knowing what you know now, would you hire them again?").selectOption("yes");
  await page.getByLabel("Anything to add (optional)").fill("Picked up the codebase quickly; already leading the payments migration.");
  await shot(page, "171-check-in");
  await page.click('button:has-text("Submit review")');
  await page.waitForSelector("text=Final interview score");
  await shot(page, "172-check-in-submitted");
  await page.goto(`${BASE}/app/quality`);
  await page.waitForSelector("text=Which interview signals predict later ratings?");
  await shot(page, "173-quality-of-hire");
  await browser.close();
  await db.end();
  if (errors.length) {
    console.error("UI errors:\n" + errors.join("\n"));
    process.exit(1);
  }
  console.log("\nPHASE 17 UI CHECK PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
