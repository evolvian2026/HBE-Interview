/**
 * Phase 14 screenshots: writing a test case, a run in the browser and its result, a case page, and the test bench.
 * Run after scripts/smoke-phase14.ts:  OUT=./screens npx tsx e2e/ui-phase14.ts
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
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true, caret: "initial" });
  console.log("📸", name);
}

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

  // Write a case from scratch.
  await page.goto(`${BASE}/app/test-bench/cases/new`);
  await page.getByLabel("Title").fill("Written: vague answers, no ownership");
  await page.getByLabel("Transcript").fill(
    [
      "Interviewer: Tell me about a recent backend problem you solved.",
      "Candidate: We had some performance issues and the team fixed them. It was a group effort and things got better.",
      "Interviewer: What did you personally do?",
      "Candidate: I helped where I could, mostly testing. I don't remember the details of the fix.",
      "Interviewer: How did you know it was fixed?",
      "Candidate: Users stopped complaining.",
    ].join("\n"),
  );
  const selects = page.locator("select");
  const n = await selects.count();
  for (let i = 2; i < n - 1; i++) await selects.nth(i).selectOption("2");
  await page.getByLabel("Expected recommendation").selectOption("no_hire");
  await shot(page, "141-write-test-case");
  await page.click('button:has-text("Save test case")');
  await page.waitForURL(/\/app\/test-bench\/cases\//);
  await page.waitForSelector("text=What the evaluator reads");
  await shot(page, "143-test-case");

  // Run the bench from the browser and wait for the result.
  await page.goto(`${BASE}/app/test-bench`);
  await page.selectOption('select:near(:text("Score each case"))', "2").catch(() => undefined);
  await page.click('button:has-text("Run the test bench")');
  await page.waitForURL(/\/app\/test-bench\/runs\//);
  await page.waitForSelector("text=What this run shows");
  await page.waitForFunction(() => !document.body.innerText.includes("Scoring…"), undefined, { timeout: 120_000 });
  await page.reload();
  await shot(page, "142-test-run-result");
  await page.goto(`${BASE}/app/test-bench`);
  await shot(page, "140-test-bench");

  await browser.close();
  if (errors.length) {
    console.error("UI errors:\n" + errors.join("\n"));
    process.exit(1);
  }
  console.log("\nPHASE 14 UI CHECK PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
