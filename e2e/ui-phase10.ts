/**
 * Phase 10 screenshots: talent-pool suggestions on a drive, and the staff inbox. Run after scripts/smoke-phase10.ts
 * (which leaves a pooled set of people and inbox work):  OUT=./screens npx tsx e2e/ui-phase10.ts
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
  const [{ org_id: orgId }] = (await db.query("select org_id from users where email = $1", [email])).rows;
  // Put the people the Phase 10 smoke test named back in the pool so an active drive has suggestions.
  await db.query("update candidates set pool_consent_at = now(), pool_expires_at = now() + interval '1 year' where org_id = $1 and (name like 'Sana Strongfit%' or name like 'Dev Goodfit%' or name like 'Wen Weakfit%')", [orgId]);
  await db.end();

  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !/monaco|cdn|Failed to load resource/i.test(m.text()) && errors.push(`console: ${m.text()}`));
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState("networkidle");
  await page.fill('input[type="email"]', process.env.ADMIN_EMAIL!);
  await page.fill('input[type="password"]', process.env.ADMIN_PASSWORD!);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/app`);
  // A fresh drive for a payments ledger role with known skills.
  const jd = "We are hiring a Senior Backend Engineer for our ledger team: Node.js services on PostgreSQL with Kafka event streams, some Go, deployed on Kubernetes with Terraform. Responsibilities: design and own payment ledger services, review designs, mentor engineers and keep production reliable. 5+ years of backend experience.";
  const created = await page.request.post(`${BASE}/api/drives`, { data: { title: "Senior Ledger Engineer", jdText: jd }, headers: { origin: BASE } });
  const drive = (await created.json()) as { id: string };
  await page.request.post(`${BASE}/api/drives/${drive.id}/publish`, { data: {}, headers: { origin: BASE } });
  const db2 = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db2.connect();
  await db2.query(
    `update drive_versions set config = jsonb_set(jsonb_set(jsonb_set(config, '{roleProfile,mustHaveSkills}', '["Node.js","PostgreSQL","Kafka","Go"]'), '{roleProfile,niceToHaveSkills}', '["Kubernetes","Terraform"]'), '{roleProfile,seniority}', '"senior"')
      where id = (select current_version_id from drives where id = $1)`,
    [drive.id],
  );
  await db2.end();
  await page.goto(`${BASE}/app/drives/${drive.id}`);
  await page.waitForSelector("text=Suggested from your talent pool");
  await page.locator('input[aria-label^="Select Sana Strongfit"]').first().check();
  await shot(page, "100-pool-suggestions", 'section:has(> div > h2:has-text("Suggested from your talent pool"))');
  await page.goto(`${BASE}/app/inbox`);
  await shot(page, "101-staff-inbox");
  await browser.close();
  if (errors.length) {
    console.error("UI errors:\n" + errors.join("\n"));
    process.exit(1);
  }
  console.log("UI PHASE 10 CHECK PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
