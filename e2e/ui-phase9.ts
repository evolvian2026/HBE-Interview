/**
 * Phase 9 screenshots: candidate talent-pool opt-in, talent search, candidate profile, hiring insights.
 * Run after scripts/smoke-phase9.ts:  OUT=./screens npx tsx e2e/ui-phase9.ts
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
  await page.addStyleTag({ content: "header { position: static !important; }" });
  if (selector) await page.locator(selector).first().screenshot({ path: `${OUT}/${name}.png`, caret: "initial" });
  else await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true, caret: "initial" });
  console.log("📸", name);
}

async function main() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const email = process.env.ADMIN_EMAIL!.toLowerCase();
  const [c] = (
    await db.query(
      `select c.access_token, c.candidate_id from candidacies c join combined_reports r on r.candidacy_id = c.id and r.status = 'ready'
        join resumes res on res.candidacy_id = c.id and res.parsed is not null
       where c.org_id = (select org_id from users where email = $1) order by c.created_at desc limit 1`,
      [email],
    )
  ).rows;
  await db.query("update candidates set pool_consent_at = null, pool_expires_at = null, tags = '[\"silver medalist\", \"payments\"]' where id = $1", [c.candidate_id]);
  await db.end();

  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const cand = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  cand.on("pageerror", (e) => errors.push(`candidate pageerror: ${e.message}`));
  await cand.goto(`${BASE}/c/${c.access_token}`);
  await shot(cand, "90-candidate-talent-pool-offer", "section[aria-labelledby=talent-pool]");
  await cand.click('button:has-text("Keep me in mind")');
  await cand.waitForSelector("text=Leave the talent pool");

  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !/monaco|cdn|Failed to load resource/i.test(m.text()) && errors.push(`console: ${m.text()}`));
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState("networkidle");
  await page.fill('input[type="email"]', process.env.ADMIN_EMAIL!);
  await page.fill('input[type="password"]', process.env.ADMIN_PASSWORD!);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/app`);
  await page.goto(`${BASE}/app/talent?pool=1`);
  await shot(page, "91-talent-search");
  await page.goto(`${BASE}/app/talent/${c.candidate_id}`);
  await shot(page, "92-talent-profile");
  await page.goto(`${BASE}/app/insights?days=30`);
  await shot(page, "93-hiring-insights");
  await browser.close();
  if (errors.length) {
    console.error("UI errors:\n" + errors.join("\n"));
    process.exit(1);
  }
  console.log("UI PHASE 9 CHECK PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
