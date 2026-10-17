/**
 * Automated accessibility checks (axe-core, WCAG 2.1 A/AA rules) on the main staff and candidate pages.
 *   A11Y_CANDIDACY_ID=… A11Y_TOKEN=… npx tsx e2e/a11y-check.ts      (defaults: latest completed candidate)
 * Fails on any "serious" or "critical" violation.
 */
import "../scripts/load-env";
import { chromium, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

async function audit(page: Page, label: string) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude(".monaco-editor").analyze();
  const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const minor = r.violations.length - bad.length;
  console.log(`${bad.length ? "✗" : "✓"} ${label}${minor ? ` (${minor} minor)` : ""}`);
  for (const v of bad) {
    console.log(`   [${v.impact}] ${v.id}: ${v.help}`);
    for (const n of v.nodes.slice(0, 4)) console.log(`      ${n.target.join(" ")} — ${n.failureSummary?.split("\n")[1]?.trim() ?? ""}`);
  }
  return bad.length;
}

async function main() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const [c] = (
    await db.query(
      "select c.id, c.access_token, c.drive_id from candidacies c join combined_reports r on r.candidacy_id = c.id join users u on u.org_id = c.org_id where r.status = 'ready' and u.email = $1 order by c.created_at desc limit 1",
      [process.env.ADMIN_EMAIL!.toLowerCase()],
    )
  ).rows;
  const [fresh] = (await db.query("select access_token from candidacies where stage = 'invited' and org_id = (select org_id from users where email = $1) order by created_at desc limit 1", [process.env.ADMIN_EMAIL!.toLowerCase()])).rows;
  const [lobby] = (await db.query("select access_token, current_round_index from candidacies c where stage in ('ready','round_available') and org_id = (select org_id from users where email = $1) and not exists (select 1 from round_sessions s where s.candidacy_id = c.id and s.round_index = c.current_round_index) order by created_at desc limit 1", [process.env.ADMIN_EMAIL!.toLowerCase()])).rows;
  const [live] = (await db.query("select c.access_token, s.round_index from round_sessions s join candidacies c on c.id = s.candidacy_id where s.status = 'active' and c.org_id = (select org_id from users where email = $1) order by s.created_at desc limit 1", [process.env.ADMIN_EMAIL!.toLowerCase()])).rows;
  await db.end();
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  let failures = 0;
  await page.goto(`${BASE}/login`);
  failures += await audit(page, "login");
  await page.waitForLoadState("networkidle");
  await page.fill('input[type="email"]', process.env.ADMIN_EMAIL!);
  await page.fill('input[type="password"]', process.env.ADMIN_PASSWORD!);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/app`);
  const staffPages: [string, string][] = [
    ["drives list", "/app"],
    ["drive", `/app/drives/${c.drive_id}`],
    ["drive editor", `/app/drives/${c.drive_id}/edit`],
    ["analytics", `/app/drives/${c.drive_id}/analytics`],
    ["fairness", `/app/drives/${c.drive_id}/fairness`],
    ["candidate report", `/app/candidates/${c.id}`],
    ["decisions", "/app/gate-queue"],
    ["settings", "/app/settings"],
    ["security", "/app/security"],
    ["audit log", "/app/audit"],
    ["data requests", "/app/data-requests"],
    ["usage", "/app/usage"],
    ["platform", "/app/platform"],
    ["operations", "/app/platform/ops"],
  ];
  for (const [label, path] of staffPages) {
    await page.goto(BASE + path);
    failures += await audit(page, label);
  }
  const cand = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await cand.goto(`${BASE}/c/${c.access_token}`);
  failures += await audit(cand, "candidate hub (completed)");
  if (fresh) {
    await cand.goto(`${BASE}/c/${fresh.access_token}`);
    failures += await audit(cand, "candidate consent");
  }
  if (lobby) {
    await cand.goto(`${BASE}/c/${lobby.access_token}/round/${lobby.current_round_index}`);
    await cand.waitForSelector("text=How would you like to answer?");
    failures += await audit(cand, "interview lobby");
    if (!live) {
      await cand.click('button:has-text("Start round")');
      await cand.waitForSelector("text=AI interviewer at", { timeout: 30_000 });
      failures += await audit(cand, "interview room");
    }
  }
  if (live) {
    await cand.goto(`${BASE}/c/${live.access_token}/round/${live.round_index}`);
    await cand.waitForSelector("textarea", { timeout: 30_000 });
    failures += await audit(cand, "interview room");
  }
  await browser.close();
  if (failures) {
    console.error(`\nA11Y CHECK FAILED: ${failures} serious/critical violation type(s)`);
    process.exit(1);
  }
  console.log("\nA11Y CHECK PASSED (no serious or critical WCAG 2.1 AA violations)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
