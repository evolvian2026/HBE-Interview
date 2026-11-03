/**
 * Phase 16 screenshots: copied-code checks (matches, problem leak status, known solutions), a side-by-side match,
 * and the flag on a candidate report. Run after scripts/smoke-phase16.ts:  OUT=./screens npx tsx e2e/ui-phase16.ts
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
  const [m] = (
    await db.query(
      "select m.id, fa.candidacy_id from code_matches m join code_fingerprints fa on fa.id = m.a_id where m.b_id is not null and m.org_id = (select org_id from users where email = $1) order by m.score desc, m.created_at desc limit 1",
      [process.env.ADMIN_EMAIL!.toLowerCase()],
    )
  ).rows as { id: string; candidacy_id: string }[];
  if (!m) throw new Error("Run scripts/smoke-phase16.ts first");
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

  await page.goto(`${BASE}/app/code-similarity?status=all`);
  await page.waitForSelector("h1:has-text(\"Copied-code checks\")");
  await shot(page, "160-code-checks");
  await page.goto(`${BASE}/app/code-similarity/${m.id}`);
  await page.waitForSelector("text=Your conclusion");
  await shot(page, "161-code-match");
  await page.goto(`${BASE}/app/candidates/${m.candidacy_id}`);
  await page.waitForSelector("text=similar code");
  await page.addStyleTag({ content: "header{position:static !important}" });
  await page.screenshot({ path: `${OUT}/162-report-flag.png`, clip: { x: 0, y: 0, width: 1440, height: 300 }, caret: "initial" });
  console.log("📸", "162-report-flag");
  await browser.close();
  await db.end();
  if (errors.length) {
    console.error("UI errors:\n" + errors.join("\n"));
    process.exit(1);
  }
  console.log("\nPHASE 16 UI CHECK PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
