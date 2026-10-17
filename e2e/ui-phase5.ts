/**
 * Phase 5 screenshots: two-factor setup and sign-in, audit log, data requests, candidate "Your data", operations.
 *   OUT=./screens npx tsx e2e/ui-phase5.ts
 */
import "../scripts/load-env";
import { chromium, type Page } from "@playwright/test";
import fs from "node:fs";
import pg from "pg";
import { base32Decode, totp } from "../src/lib/core/totp";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT ?? "screens";
fs.mkdirSync(OUT, { recursive: true });
const errors: string[] = [];

async function shot(page: Page, name: string) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true, caret: "initial" });
  console.log("📸", name);
}

async function api(cookie: string, method: string, path: string, body?: unknown) {
  const res = await fetch(BASE + path, { method, headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return { json: text ? JSON.parse(text) : {}, setCookie: res.headers.getSetCookie() };
}

async function main() {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !/monaco|cdn|Failed to load resource/i.test(m.text()) && errors.push(`console: ${m.text()}`));
  page.on("dialog", (d) => d.accept());
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState("networkidle");
  await page.fill('input[type="email"]', process.env.ADMIN_EMAIL!);
  await page.fill('input[type="password"]', process.env.ADMIN_PASSWORD!);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/app`);
  const cookie = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");

  // Security page with the QR code (setup started, not enabled, so the shared admin login stays password-only).
  await page.goto(`${BASE}/app/security`);
  await page.click("text=Set up two-factor sign-in");
  await page.waitForSelector('img[alt="QR code for your authenticator app"]');
  await shot(page, "50-security-2fa-setup");

  // A user with 2FA on, to show the second sign-in step.
  const stamp = Date.now();
  const pw = "Violet-Harbour-27";
  await api(cookie, "POST", "/api/settings/users", { name: "Tara Recruiter", email: `tara.${stamp}@hbe.local`, password: pw, role: "recruiter" });
  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `tara.${stamp}@hbe.local`, password: pw }) });
  const taraCookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const setup = (await api(taraCookie, "POST", "/api/auth/2fa/setup")).json as { secret: string };
  await api(taraCookie, "POST", "/api/auth/2fa/enable", { code: totp(base32Decode(setup.secret)) });
  const p2 = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await p2.goto(`${BASE}/login`);
  await p2.waitForLoadState("networkidle");
  await p2.fill('input[type="email"]', `tara.${stamp}@hbe.local`);
  await p2.fill('input[type="password"]', pw);
  await p2.click('button[type="submit"]');
  await p2.waitForSelector("text=Two-factor sign-in");
  await shot(p2, "51-login-2fa");

  // Data request from a candidate in this organisation.
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const [drive] = (await db.query("select d.id from drives d join users u on u.org_id = d.org_id where u.email = $1 and d.status = 'active' order by d.created_at desc limit 1", [process.env.ADMIN_EMAIL!.toLowerCase()])).rows;
  await db.end();
  const inv = (await api(cookie, "POST", `/api/drives/${drive.id}/invites`, { candidates: [{ name: "Meera Iyer", email: `meera.${stamp}@example.com` }] })).json as { results: { link: string }[] };
  const token = inv.results[0].link.split("/c/")[1];
  await api("", "POST", `/api/c/${token}/consent`, { accept: true, webcam: true });
  await api("", "POST", `/api/c/${token}/deletion`, { reason: "I've accepted another offer and would like my data removed." });
  const cand = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await cand.goto(`${BASE}/c/${token}`);
  await cand.waitForSelector("text=You asked for your data to be deleted");
  await shot(cand, "52-candidate-your-data");
  await page.goto(`${BASE}/app/data-requests`);
  await shot(page, "53-data-requests");
  await page.goto(`${BASE}/app/audit?days=1`);
  await shot(page, "54-audit-log");
  await page.goto(`${BASE}/app/platform/ops`);
  await shot(page, "55-operations");

  // Tidy up: delete the demo candidate's data and Tara's account sessions.
  await page.goto(`${BASE}/app/data-requests`);
  await page.click('button:has-text("Delete now")');
  await page.waitForSelector("text=Nothing waiting");
  await browser.close();
  if (errors.length) {
    console.error("UI errors:\n" + errors.join("\n"));
    process.exit(1);
  }
  console.log("UI PHASE 5 CHECK PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
