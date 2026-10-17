/**
 * Phase 7 screenshots: calibration dashboard, blind review and reveal, candidate adjustment request, staff decision,
 * adjusted round lobby. Run after scripts/smoke-phase7.ts:  OUT=./screens npx tsx e2e/ui-phase7.ts
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
  if (selector) await page.locator(selector).first().screenshot({ path: `${OUT}/${name}.png`, caret: "initial" });
  else await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true, caret: "initial" });
  console.log("📸", name);
}

async function main() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const q = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows as T[];
  const email = process.env.ADMIN_EMAIL!.toLowerCase();
  const [{ org_id: orgId }] = await q<{ org_id: string }>("select org_id from users where email = $1", [email]);
  // A queued round the admin hasn't reviewed yet (fresh one if needed).
  const [queued] = await q<{ id: string }>(
    "select r.id from round_reports r join candidacies c on c.id = r.candidacy_id where c.org_id = $1 and r.status = 'ready' and r.round_type = 'technical' and not exists (select 1 from calibration_reviews x where x.report_id = r.id) order by r.created_at desc limit 1",
    [orgId],
  );
  await q("update round_reports set calibration_requested_at = now(), calibration_reason = 'sample' where id = $1", [queued.id]);

  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !/monaco|cdn|Failed to load resource/i.test(m.text()) && errors.push(`console: ${m.text()}`));
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState("networkidle");
  await page.fill('input[type="email"]', process.env.ADMIN_EMAIL!);
  await page.fill('input[type="password"]', process.env.ADMIN_PASSWORD!);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/app`);

  // Blind review: fill the form in the browser.
  await page.goto(`${BASE}/app/calibration/${queued.id}`);
  await page.waitForSelector("text=Your scores");
  const groups = page.locator('[role="radiogroup"]');
  const n = await groups.count();
  for (let i = 0; i < n; i++) await groups.nth(i).locator("label").nth(i % 2 ? 2 : 3).click();
  await page.selectOption("select", "hire");
  await page.fill("textarea", "Solid problem-solving; code was correct but edge cases were only discussed when prompted.");
  await shot(page, "70-blind-review");
  await page.click('button:has-text("Submit and reveal")');
  await page.waitForSelector("text=You and the AI");
  await shot(page, "71-review-reveal");
  await page.goto(`${BASE}/app/calibration?days=90&all=1`);
  await shot(page, "72-calibration-dashboard");

  // Candidate asks for adjustments; recruiter-side panel; adjusted lobby.
  const [drive] = await q<{ id: string }>("select id from drives where org_id = $1 and status = 'active' order by created_at desc limit 1", [orgId]);
  const inv = await page.request.post(`${BASE}/api/drives/${drive.id}/invites`, { data: { candidates: [{ name: "Leela Rao", email: `leela.${Date.now()}@example.com` }] }, headers: { origin: BASE } });
  const token = ((await inv.json()) as { results: { link: string }[] }).results[0].link.split("/c/")[1];
  const cand = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  cand.on("pageerror", (e) => errors.push(`candidate pageerror: ${e.message}`));
  await cand.request.post(`${BASE}/api/c/${token}/consent`, { data: { accept: true, webcam: true } });
  await cand.goto(`${BASE}/c/${token}`);
  await cand.click("text=Request adjustments…");
  await cand.selectOption("section[aria-labelledby=adjustments] select", "50");
  await cand.check("section[aria-labelledby=adjustments] input[type=checkbox]");
  await cand.fill("section[aria-labelledby=adjustments] textarea", "I have ADHD; short breaks help me stay focused in long sessions.");
  await shot(cand, "73-candidate-adjustment-request", "section[aria-labelledby=adjustments]");
  await cand.click("text=Send request");
  await cand.waitForSelector("text=You asked for");
  const [{ id: cid }] = await q<{ id: string }>("select id from candidacies where access_token = $1", [token]);
  await page.goto(`${BASE}/app/candidates/${cid}`);
  await shot(page, "74-staff-adjustment-panel", "#adjustments");
  await page.click('#adjustments button:has-text("Approve")');
  await page.waitForSelector("#adjustments >> text=Approved:");
  await q("update candidacies set stage = 'ready', current_round_index = 0 where id = $1", [cid]);
  await cand.goto(`${BASE}/c/${token}/round/0`);
  await cand.waitForSelector("text=How would you like to answer?");
  await shot(cand, "75-adjusted-round-lobby");
  await db.end();
  await browser.close();
  if (errors.length) {
    console.error("UI errors:\n" + errors.join("\n"));
    process.exit(1);
  }
  console.log("UI PHASE 7 CHECK PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
