/**
 * Phase 18 screenshots: connecting a calendar, suggested free times in the panel scheduler, and a booked interview
 * with an automatic video link. Needs CALENDAR_MOCK=true.  OUT=./screens npx tsx e2e/ui-phase18.ts
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
  const [cand] = (
    await db.query(
      "select c.id from candidacies c join combined_reports r on r.candidacy_id = c.id and r.status = 'ready' where c.org_id = $1 and c.stage = 'completed' and not exists (select 1 from hires h where h.candidacy_id = c.id) order by c.created_at desc limit 1",
      [orgId],
    )
  ).rows as { id: string }[];
  if (!cand) throw new Error("Need a completed candidate — run `npm run smoke` first");
  await db.query("delete from calendar_connections where user_id = $1", [adminId]);

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

  await page.goto(`${BASE}/app/security#calendar`);
  await page.click("text=Connect Test calendar");
  await page.waitForSelector("text=Your calendar is connected.");
  await page.locator("section#calendar").screenshot({ path: `${OUT}/180-calendar-connected.png`, caret: "initial" });
  console.log("📸", "180-calendar-connected");

  await page.goto(`${BASE}/app/candidates/${cand.id}`);
  await page.click('button:has-text("Arrange a panel interview")');
  // The admin (whose calendar is connected) sits on the panel.
  await page.locator('fieldset:has(legend:has-text("Panel")) label:has-text("Administrator") input[type="checkbox"]').check();
  await page.click('button:has-text("Suggest times when the panel is free")');
  await page.waitForSelector('[aria-label="Suggested times"] button', { timeout: 30_000 });
  await page.locator('[aria-label="Suggested times"] button').first().click();
  await page.locator('input[type="datetime-local"]').nth(1).fill("");
  await page.getByText("Create the video meeting automatically").click();
  await page.locator("form:has-text('Times to offer')").screenshot({ path: `${OUT}/181-suggested-times.png`, caret: "initial" });
  console.log("📸", "181-suggested-times");
  await page.click('button:has-text("Book and invite")');
  await page.waitForSelector("text=video link created automatically", { timeout: 30_000 });
  await page.addStyleTag({ content: "header{position:static !important}" });
  await page.locator("div.rounded-lg.border:has-text('video link created automatically')").first().screenshot({ path: `${OUT}/182-booked-with-link.png`, caret: "initial" });
  console.log("📸", "182-booked-with-link");

  // Leave the data as it was.
  await db.query("delete from panel_interviews where candidacy_id = $1", [cand.id]);
  await db.query("update candidacies set stage = 'completed' where id = $1", [cand.id]);
  await db.query("delete from calendar_connections where user_id = $1", [adminId]);
  await browser.close();
  await db.end();
  if (errors.length) {
    console.error("UI errors:\n" + errors.join("\n"));
    process.exit(1);
  }
  console.log("\nPHASE 18 UI CHECK PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
