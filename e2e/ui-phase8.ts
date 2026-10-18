/**
 * Phase 8 screenshots: arranging a panel, the candidate choosing a time, the interview kit and scorecard, the debrief
 * with the final decision, and the candidate's offer. Run after scripts/smoke.ts:  OUT=./screens npx tsx e2e/ui-phase8.ts
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
  // Keep the sticky staff header from overlapping screenshots.
  await page.addStyleTag({ content: "header { position: static !important; }" });
  if (selector) await page.locator(selector).first().screenshot({ path: `${OUT}/${name}.png`, caret: "initial" });
  else await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true, caret: "initial" });
  console.log("📸", name);
}

/** "YYYY-MM-DDTHH:mm" in the browser's local time, n days from now at the given hour. */
const localSlot = (days: number, hour: number) => {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setHours(hour, 0, 0, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

async function main() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const q = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows as T[];
  const email = process.env.ADMIN_EMAIL!.toLowerCase();
  const [{ org_id: orgId }] = await q<{ org_id: string }>("select org_id from users where email = $1", [email]);
  const [c] = await q<{ id: string; drive_id: string; access_token: string }>(
    "select c.id, c.drive_id, c.access_token from candidacies c join combined_reports r on r.candidacy_id = c.id where c.org_id = $1 and r.status = 'ready' and c.stage = 'completed' order by c.created_at desc limit 1",
    [orgId],
  );
  if (!c) throw new Error("Run `npm run smoke` first (needs a candidate who finished the AI rounds)");

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

  // A second panelist (hiring manager on this drive).
  const pw = "Juniper-Harbor-58";
  const hmEmail = `meera.panel.${Date.now()}@hbe.local`;
  const created = await page.request.post(`${BASE}/api/settings/users`, { data: { name: "Meera Shah", email: hmEmail, password: pw, role: "hiring_manager" }, headers: { origin: BASE } });
  const hmId = ((await created.json()) as { id: string }).id;
  await page.request.put(`${BASE}/api/settings/users/${hmId}`, { data: { driveIds: [c.drive_id] }, headers: { origin: BASE } });

  // 1) Arrange the panel.
  await page.goto(`${BASE}/app/candidates/${c.id}`);
  await page.click("text=Arrange a panel interview…");
  await page.fill('input[placeholder^="https://meet"]', "https://meet.example.com/hbe-final-panel");
  await page.fill('input[aria-label="Time option 1"]', localSlot(3, 10));
  await page.fill('input[aria-label="Time option 2"]', localSlot(4, 15));
  await page.check('label:has-text("Meera Shah") input');
  await page.check('label:has-text("Administrator") input');
  await shot(page, "80-panel-scheduler", card("Panel interviews & final decision"));
  await page.click('button:has-text("Send times to the candidate")');
  await page.waitForSelector("text=waiting for the candidate to pick a time");

  // 2) The candidate picks a time.
  const cand = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  cand.on("pageerror", (e) => errors.push(`candidate pageerror: ${e.message}`));
  await cand.goto(`${BASE}/c/${c.access_token}`);
  await cand.waitForSelector("text=Confirm this time");
  await shot(cand, "81-candidate-choose-time");
  await cand.click('button:has-text("Confirm this time")');
  await cand.waitForSelector("text=Add to calendar (.ics)");

  // 3) The interview has happened: the admin fills the kit's scorecard.
  const [iv] = await q<{ id: string }>("select id from panel_interviews where candidacy_id = $1 and status = 'scheduled' order by created_at desc limit 1", [c.id]);
  await q("update panel_interviews set scheduled_at = now() - interval '1 hour' where id = $1", [iv.id]);
  await page.goto(`${BASE}/app/panel/${iv.id}`);
  const groups = page.locator('[role="radiogroup"]');
  for (let i = 0; i < (await groups.count()); i++) await groups.nth(i).locator("label").nth(i % 3 === 0 ? 4 : 3).click();
  await page.selectOption("select", "strong_hire");
  await page.locator("textarea").nth(0).fill("Walked through the ledger design with clear trade-offs; strong ownership of the outage story.");
  await page.locator("textarea").nth(1).fill("Testing approach was thin when pushed on edge cases.");
  await shot(page, "82-interview-kit");
  await page.click('button:has-text("Submit scorecard")');
  await page.waitForSelector("text=Scorecard submitted.");

  // The second panelist disagrees.
  const hm = await (await browser.newContext()).newPage();
  await hm.request.post(`${BASE}/api/auth/login`, { data: { email: hmEmail, password: pw } });
  const competencies = (await q<{ competencies: string[] }>("select competencies from panel_interviews where id = $1", [iv.id]))[0].competencies;
  const r = await hm.request.put(`${BASE}/api/panel/${iv.id}/scorecard`, {
    data: { ratings: Object.fromEntries(competencies.map((k, i) => [k, i === 0 ? 2 : 4])), recommendation: "lean_no", concerns: "Couldn't reason about failure modes in the payments flow without heavy prompting." },
    headers: { origin: BASE },
  });
  if (!r.ok()) throw new Error(`hm scorecard ${r.status()} ${await r.text()}`);

  // 4) Debrief and decision.
  await page.goto(`${BASE}/app/candidates/${c.id}`);
  await page.click('label:has-text("Make an offer")');
  await page.fill('textarea[placeholder^="What the decision rests on"]', "Strong system design and ownership; testing gap is coachable. Panel split on depth — offer at level, with a testing-focused onboarding plan.");
  await shot(page, "83-panel-debrief-decision", card("Panel interviews & final decision"));
  await page.click('button:has-text("Record decision")');
  await page.waitForSelector("text=candidate told");

  // 5) The candidate's page.
  await cand.goto(`${BASE}/c/${c.access_token}`);
  await cand.waitForSelector("text=Good news!");
  await shot(cand, "84-candidate-offer");
  await db.end();
  await browser.close();
  if (errors.length) {
    console.error("UI errors:\n" + errors.join("\n"));
    process.exit(1);
  }
  console.log("UI PHASE 8 CHECK PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
