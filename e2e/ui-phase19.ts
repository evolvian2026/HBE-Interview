/**
 * Phase 19 screenshots: the screening-test settings on a drive, a candidate taking the test (instructions, a
 * question, the result), and the drive's test results by college. Creates and closes its own drive.
 *   OUT=./screens npx tsx e2e/ui-phase19.ts
 */
import "../scripts/load-env";
import { chromium, type Page } from "@playwright/test";
import fs from "node:fs";
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT ?? "screens";
fs.mkdirSync(OUT, { recursive: true });
const errors: string[] = [];
const JD = "We are hiring graduate software engineers for our campus programme. You will build and test backend services in Python or Java, write SQL, work with Git, and learn from senior engineers. We value problem solving, clear communication and curiosity. Strong fundamentals in data structures, algorithms and databases are expected.";

async function shot(page: Page, name: string, fullPage = true) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage, caret: "initial" });
  console.log("📸", name);
}

async function main() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (x) => x.type() === "error" && !/monaco|cdn|Failed to load resource/i.test(x.text()) && errors.push(`console: ${x.text()}`));
  page.on("dialog", (d) => d.accept());
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState("networkidle");
  await page.fill('input[type="email"]', process.env.ADMIN_EMAIL!);
  await page.fill('input[type="password"]', process.env.ADMIN_PASSWORD!);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/app`);
  const h = { origin: BASE };
  const stamp = Date.now();
  const d = (await (await page.request.post(`${BASE}/api/drives`, { data: { title: `Campus Graduate Engineer ${String(stamp).slice(-4)}`, jdText: JD }, headers: h })).json()) as { id: string };
  try {
    // Turn the test on in the drive editor.
    await page.goto(`${BASE}/app/drives/${d.id}/edit`);
    await page.getByText("Screening test", { exact: true }).click();
    await page.waitForSelector("text=Pass mark (%)");
    await page.locator("div.rounded-lg.bg-slate-50:has-text('Screening test')").first().screenshot({ path: `${OUT}/190-test-settings.png`, caret: "initial" });
    console.log("📸", "190-test-settings");
    const [{ draft }] = (await db.query("select draft from drives where id = $1", [d.id])).rows as { draft: Record<string, unknown> }[];
    const screening = { enabled: true, sections: { quant: 3, logical: 3, verbal: 2, technical: 2 }, durationMin: 15, passMark: 50, onFail: "review", showScore: true };
    await page.request.put(`${BASE}/api/drives/${d.id}`, { data: { config: { ...draft, screening } }, headers: h });
    const pub = await page.request.post(`${BASE}/api/drives/${d.id}/publish`, { data: {}, headers: h });
    if (!pub.ok()) throw new Error(`publish failed: ${await pub.text()}`);
    // A few candidates from two colleges take the test through the API, then one in the browser.
    const invite = async (name: string, college: string) => {
      const r = (await (await page.request.post(`${BASE}/api/drives/${d.id}/invites`, { data: { candidates: [{ name, email: `${name.split(" ")[0].toLowerCase()}.${stamp}@example.com`, college }] }, headers: h })).json()) as { results: { link: string }[] };
      const token = r.results[0].link.split("/c/")[1];
      await page.request.post(`${BASE}/api/c/${token}/consent`, { data: { accept: true }, headers: h });
      return token;
    };
    for (const [name, college, right] of [["Ishaan Rao", "IIT Bombay", 9], ["Kavya Nair", "IIT Bombay", 6], ["Manoj Pillai", "VIT Vellore", 4], ["Neha Joshi", "VIT Vellore", 8]] as const) {
      const t = await invite(name, college);
      await page.request.post(`${BASE}/api/c/${t}/screening/start`, { data: {}, headers: h });
      const [{ id }] = (await db.query("select id from candidacies where access_token = $1", [t])).rows as { id: string }[];
      const [{ paper }] = (await db.query("select paper from screening_attempts where candidacy_id = $1", [id])).rows as { paper: { qid: string; correct: number }[] }[];
      for (const [i, p] of paper.entries()) await page.request.put(`${BASE}/api/c/${t}/screening/answer`, { data: { qid: p.qid, choice: i < right ? p.correct : (p.correct + 1) % 4 }, headers: h });
      await page.request.post(`${BASE}/api/c/${t}/screening/submit`, { data: {}, headers: h });
    }
    const token = await invite("Priya Sharma", "IIT Bombay");
    const cand = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
    cand.on("pageerror", (e) => errors.push(`candidate pageerror: ${e.message}`));
    cand.on("dialog", (x) => x.accept());
    await cand.goto(`${BASE}/c/${token}`);
    await cand.waitForSelector("text=Next: a short screening test");
    await shot(cand, "191-candidate-next-step");
    await cand.click("text=Go to the test");
    await cand.waitForSelector("text=Start the test");
    await shot(cand, "192-test-instructions");
    await cand.click('button:has-text("Start the test")');
    await cand.waitForSelector("text=Question 1 of 10");
    for (let i = 0; i < 10; i++) {
      await cand.locator('input[type="radio"]').nth(i % 3).check();
      if (i === 2) await shot(cand, "193-test-question");
      if (i < 9) await cand.click('button:has-text("Next →")');
    }
    await cand.click('button:has-text("Submit the test")');
    await cand.waitForSelector("text=Test submitted");
    await shot(cand, "194-test-submitted", false);
    await page.goto(`${BASE}/app/drives/${d.id}/screening`);
    await page.waitForSelector("text=By college");
    await shot(page, "195-test-results");
  } finally {
    await page.request.post(`${BASE}/api/drives/${d.id}/status`, { data: { status: "closed" }, headers: h });
    await browser.close();
    await db.end();
  }
  if (errors.length) {
    console.error("UI errors:\n" + errors.join("\n"));
    process.exit(1);
  }
  console.log("\nPHASE 19 UI CHECK PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
