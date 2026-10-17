/**
 * Phase 6 screenshots: SSO and branding settings, branded candidate pages, SSO sign-in step.
 * Run after scripts/smoke-phase6.ts:  OUT=./screens npx tsx e2e/ui-phase6.ts
 */
import "../scripts/load-env";
import { chromium, type Page } from "@playwright/test";
import fs from "node:fs";
import pg from "pg";

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
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const [org] = (await db.query("select o.id from organizations o join sso_configs s on s.org_id = o.id where o.brand_color is not null order by o.created_at desc limit 1")).rows;
  const [cand] = (await db.query("select c.access_token, d.open_slug from candidacies c join drives d on d.id = c.drive_id where c.org_id = $1 order by c.created_at desc limit 1", [org.id])).rows;
  await db.end();

  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !/monaco|cdn|Failed to load resource/i.test(m.text()) && errors.push(`console: ${m.text()}`));

  await page.goto(`${BASE}/login`);
  await page.waitForLoadState("networkidle");
  await page.click("text=Sign in with single sign-on");
  await page.fill('input[type="email"]', "priya@acme.io");
  await shot(page, "60-login-sso");
  await page.click("text=Use a password instead");
  await page.fill('input[type="email"]', process.env.ADMIN_EMAIL!);
  await page.fill('input[type="password"]', process.env.ADMIN_PASSWORD!);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/app`);
  // Act inside the SSO organisation as a platform admin.
  const res = await page.request.post(`${BASE}/api/platform/switch`, { data: { orgId: org.id }, headers: { origin: BASE } });
  if (!res.ok()) throw new Error(`switch failed ${res.status()}`);
  await page.goto(`${BASE}/app/settings`);
  await shot(page, "61-settings-sso", card("Single sign-on"));
  await shot(page, "62-settings-branding", card("Branding (candidate pages)"));
  await page.request.post(`${BASE}/api/platform/switch`, { data: { orgId: "00000000-0000-4000-8000-000000000001" }, headers: { origin: BASE } });

  const c = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  c.on("pageerror", (e) => errors.push(`candidate pageerror: ${e.message}`));
  await c.goto(`${BASE}/c/${cand.access_token}`);
  await shot(c, "63-branded-candidate-hub");
  await c.goto(`${BASE}/i/${cand.open_slug}`);
  await shot(c, "64-branded-open-application");
  await browser.close();
  if (errors.length) {
    console.error("UI errors:\n" + errors.join("\n"));
    process.exit(1);
  }
  console.log("UI PHASE 6 CHECK PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
