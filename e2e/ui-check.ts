/**
 * Browser walkthrough of staff and candidate UIs with screenshots (mock AI).
 *   BASE_URL=http://localhost:3000 OUT=./screens npx tsx e2e/ui-check.ts
 */
import "../scripts/load-env";
import { chromium, type Page } from "@playwright/test";
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT ?? "screens";
fs.mkdirSync(OUT, { recursive: true });
const errors: string[] = [];

async function shot(page: Page, name: string) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  // caret: "initial" avoids Playwright injecting caret styles that look like a hydration mismatch.
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true, caret: "initial" });
  console.log("📸", name);
}

async function main() {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !/monaco|cdn|Failed to load resource/i.test(m.text()) && errors.push(`console: ${m.text()}`));

  // Staff
  await page.goto(`${BASE}/login`);
  await shot(page, "01-login");
  await page.fill('input[type="email"]', process.env.ADMIN_EMAIL!);
  await page.fill('input[type="password"]', process.env.ADMIN_PASSWORD!);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/app`);
  await shot(page, "02-drives");
  await page.click("text=Senior Backend Engineer >> nth=0");
  await page.waitForURL(/\/app\/drives\/[^/]+$/);
  await shot(page, "03-drive-overview");
  const driveUrl = page.url();
  await page.click("text=Configure");
  await page.waitForURL(/edit$/);
  await page.waitForSelector("text=Interview rounds & gates");
  await shot(page, "04-drive-config");
  await page.goto(driveUrl);
  const candidateLink = page.locator('a[href^="/app/candidates/"]').first();
  await candidateLink.click();
  await page.waitForURL(/\/app\/candidates\//);
  await page.waitForSelector("text=Combined report");
  await shot(page, "05-candidate-report");
  if (process.env.REPORT_CANDIDACY_ID) {
    await page.goto(`${BASE}/app/candidates/${process.env.REPORT_CANDIDACY_ID}`);
    await page.waitForSelector("text=Combined report");
    await page.locator("details summary").first().click();
    await shot(page, "05b-completed-report");
  }
  await page.goto(`${BASE}/app/gate-queue`);
  await shot(page, "06-decisions");
  await page.goto(`${BASE}/app/settings`);
  await page.waitForSelector("text=Company values");
  await shot(page, "07-settings");

  // Phase 2 pages
  if (process.env.PHASE2) {
    await page.goto(`${driveUrl}/analytics`);
    await page.waitForSelector("text=Score distributions");
    await shot(page, "20-analytics");
    await page.goto(`${BASE}/app/usage?range=all`);
    await shot(page, "21-usage");
    await page.goto(driveUrl);
    const boxes = page.locator('input[name="ids"]');
    if ((await boxes.count()) >= 2) {
      await boxes.nth(0).check();
      await boxes.nth(1).check();
      await page.click("text=Compare selected");
      await page.waitForSelector("text=Compare candidates");
      await shot(page, "22-compare");
    }
    await page.goto(`${driveUrl}/problems`);
    await shot(page, "23-custom-problems");
    if (process.env.REPORT_CANDIDACY_ID) {
      await page.goto(`${BASE}/print/candidates/${process.env.REPORT_CANDIDACY_ID}?masked=1`);
      await page.waitForSelector("text=HBE Interview report");
      await shot(page, "24-print-masked");
    }
    await page.goto(`${BASE}/app/drives/new`);
    await shot(page, "25-templates");
    if (process.env.PRIORITIZATION_LINK) {
      const p2 = await ctx.newPage();
      await p2.goto(process.env.PRIORITIZATION_LINK);
      await p2.waitForSelector("text=Submit ranking", { timeout: 30_000 });
      await p2.click("text=</> Code");
      await p2.fill('textarea[placeholder="Write your snippet here…"]', "SELECT team, COUNT(*) FROM incidents GROUP BY team;");
      await shot(p2, "26-room-prioritization-snippet");
      await p2.close();
    }
  }

  // New candidate through the UI
  await page.goto(driveUrl);
  await page.fill("textarea", `Ravi Kumar, ravi.${Date.now()}@example.com`);
  await page.click("text=Create invites");
  await page.waitForSelector("text=Copy personal link");
  await ctx.close();

  // Candidate context (no staff cookie)
  const cctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const cpage = await cctx.newPage();
  cpage.on("pageerror", (e) => errors.push(`candidate pageerror: ${e.message}`));
  const link = process.env.CANDIDATE_LINK;
  if (link) {
    await cpage.goto(link);
    await shot(cpage, "10-candidate-consent");
    await cpage.check("text=I consent");
    await cpage.check("text=I agree to the interview rules");
    await cpage.click("text=Accept and continue");
    await cpage.waitForSelector("text=Upload your resume");
    await shot(cpage, "11-candidate-resume");
    await cpage.setInputFiles('input[type="file"]', process.env.RESUME_PATH!);
    await cpage.waitForSelector("text=Review your profile", { timeout: 60_000 });
    await shot(cpage, "12-candidate-profile");
    await cpage.click("text=Confirm profile");
    await cpage.waitForSelector("text=Link your project repositories");
    await cpage.fill('input[placeholder="https://github.com/owner/repo"]', "https://github.com/ravik/orders-service");
    await shot(cpage, "13-candidate-projects");
    await cpage.click("text=Save and continue");
    await cpage.waitForSelector("text=Your interview rounds");
    await shot(cpage, "14-candidate-rounds");
    await cpage.click("text=Start round");
    await cpage.waitForSelector("text=How would you like to answer?");
    await shot(cpage, "15-room-lobby");
    await cpage.click('button:has-text("Start round")');
    await cpage.waitForSelector("text=AI interviewer at", { timeout: 30_000 });
    for (let i = 0; i < 4; i++) {
      await cpage.fill("textarea", "I built the order service end to end: I designed the API, chose PostgreSQL for transactional guarantees, added Redis caching for hot reads, and measured p99 latency improvements with load tests before and after the change.");
      await cpage.keyboard.press("Enter");
      await cpage.waitForFunction(() => !document.body.innerText.includes("Waiting…"), null, { timeout: 30_000 });
    }
    await shot(cpage, "16-room-chat");
    // Advance until an exercise panel appears (system design or coding)
    for (let i = 0; i < 25; i++) {
      if (await cpage.locator("text=Submit response").count() || (await cpage.locator("text=Run samples").count())) break;
      await cpage.fill("textarea >> nth=0", "My approach weighs consistency against latency: I would use idempotency keys, an outbox table and retries with exponential backoff, and I would measure success with error rates and p99 latency dashboards.");
      await cpage.keyboard.press("Enter");
      await cpage.waitForFunction(() => !document.body.innerText.includes("Waiting…"), null, { timeout: 30_000 });
    }
    await cpage.waitForTimeout(2500);
    await shot(cpage, "17-room-exercise");
  }
  await browser.close();
  if (errors.length) {
    console.error("Browser errors:\n" + errors.join("\n"));
    process.exit(1);
  }
  console.log("UI CHECK PASSED");
}

main().catch((e) => {
  console.error("UI CHECK FAILED", e, errors);
  process.exit(1);
});
