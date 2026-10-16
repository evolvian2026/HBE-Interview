/**
 * Phase 4 screenshots: platform console, org switching banner, KB search preview. Run after scripts/smoke-phase4.ts:
 *   OUT=./screens npx tsx e2e/ui-phase4.ts
 */
import "../scripts/load-env";
import { chromium, type Page } from "@playwright/test";
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT ?? "screens";
fs.mkdirSync(OUT, { recursive: true });
const errors: string[] = [];
const card = (title: string) => `section:has(> div > h2:text-is("${title}"))`;

async function shot(page: Page, name: string, selector?: string) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  if (selector) await page.locator(selector).first().screenshot({ path: `${OUT}/${name}.png`, caret: "initial" });
  else await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true, caret: "initial" });
  console.log("📸", name);
}

async function main() {
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

  await page.goto(`${BASE}/app/platform`);
  await page.waitForSelector("text=New organisation");
  await shot(page, "40-platform-console");

  // Enter the most recent Acme organisation.
  await page.locator('tr:has-text("Acme") >> button:has-text("Enter")').last().click();
  await page.waitForURL(`${BASE}/app`);
  await page.waitForSelector("text=acting as an administrator");
  await shot(page, "41-acting-in-org");

  await page.goto(`${BASE}/app/settings`);
  await page.fill('input[placeholder^="e.g. How many days"]', "Is there any relocation assistance if I move cities?");
  await page.click(`${card("HR knowledge base (policy Q&A)")} >> button:has-text("Search")`);
  await page.waitForSelector("text=relevance");
  await shot(page, "42-kb-search", card("HR knowledge base (policy Q&A)"));

  await page.click("text=Return to your organisation");
  await page.waitForURL(`${BASE}/app/platform`);
  await page.waitForFunction(() => !document.body.innerText.includes("acting as an administrator"));
  await browser.close();
  if (errors.length) {
    console.error("UI errors:\n" + errors.join("\n"));
    process.exit(1);
  }
  console.log("UI PHASE 4 CHECK PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
