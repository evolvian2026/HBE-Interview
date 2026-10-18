/**
 * Phase 11 screenshots: the candidate email editor with its branded preview, and team notification channels.
 *   OUT=./screens npx tsx e2e/ui-phase11.ts
 */
import "../scripts/load-env";
import { chromium, type Page } from "@playwright/test";
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT ?? "screens";
fs.mkdirSync(OUT, { recursive: true });
const errors: string[] = [];

async function shot(page: Page, name: string, selector: string) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.addStyleTag({ content: "header { position: static !important; }" });
  await page.locator(selector).first().screenshot({ path: `${OUT}/${name}.png`, caret: "initial" });
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
  // A Slack channel to show (pointing nowhere useful; it's removed at the end).
  const r = await page.request.post(`${BASE}/api/settings/channels`, { data: { kind: "slack", name: "#hiring-backend", url: "http://127.0.0.1:9/slack/T0/B0/x", events: ["decision.needed", "panel.feedback_complete", "candidate.decided"] }, headers: { origin: BASE } });
  const { id } = (await r.json()) as { id: string };
  await page.goto(`${BASE}/app/settings#emails`);
  const section = "section#emails";
  await page.locator(`${section} select`).first().selectOption("panel_confirmed");
  await page.waitForTimeout(800);
  await shot(page, "110-email-template-editor", section);
  await shot(page, "111-team-notifications", "section#notifications");
  await page.request.delete(`${BASE}/api/settings/channels/${id}`, { headers: { origin: BASE } });
  await browser.close();
  if (errors.length) {
    console.error("UI errors:\n" + errors.join("\n"));
    process.exit(1);
  }
  console.log("UI PHASE 11 CHECK PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
