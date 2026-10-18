/**
 * Phase 12 screenshot: the User provisioning (SCIM) card right after turning it on (token shown once).
 *   OUT=./screens npx tsx e2e/ui-phase12.ts
 */
import "../scripts/load-env";
import { chromium } from "@playwright/test";
import fs from "node:fs";
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT ?? "screens";
fs.mkdirSync(OUT, { recursive: true });
const errors: string[] = [];

async function main() {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !/monaco|cdn|Failed to load resource/i.test(m.text()) && errors.push(`console: ${m.text()}`));
  page.on("dialog", (d) => d.accept());
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState("networkidle");
  await page.fill('input[type="email"]', process.env.ADMIN_EMAIL!);
  await page.fill('input[type="password"]', process.env.ADMIN_PASSWORD!);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/app`);
  await page.goto(`${BASE}/app/settings#provisioning`);
  await page.locator("section#provisioning select").selectOption("recruiter");
  await page.click('section#provisioning button:has-text("Turn on provisioning"), section#provisioning button:has-text("Rotate token")');
  await page.waitForSelector("text=won't be shown again");
  await page.addStyleTag({ content: "header { position: static !important; }" });
  await page.locator("section#provisioning").screenshot({ path: `${OUT}/120-scim-provisioning.png`, caret: "initial" });
  console.log("📸 120-scim-provisioning");
  await browser.close();
  // Remove the token created for the screenshot.
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await db.query("delete from scim_configs where org_id = (select org_id from users where email = $1)", [process.env.ADMIN_EMAIL!.toLowerCase()]);
  await db.end();
  if (errors.length) {
    console.error("UI errors:\n" + errors.join("\n"));
    process.exit(1);
  }
  console.log("UI PHASE 12 CHECK PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
