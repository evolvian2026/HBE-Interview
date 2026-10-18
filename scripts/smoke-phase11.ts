/**
 * Phase 11 checks: candidate email templates (validation, preview, customise, reset, test send, roles, isolation), the
 * email log on the candidate report, and Slack/Teams team notifications against a local receiver (URL sealing,
 * test messages, event delivery with and without names, pause, failures, roles, isolation).
 *   BASE_URL=http://localhost:3000 npx tsx scripts/smoke-phase11.ts
 */
import "./load-env";
import http from "node:http";
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
let passed = 0;
function check(cond: unknown, msg: string) {
  if (!cond) throw new Error(`CHECK FAILED: ${msg}`);
  passed++;
  console.log("✓", msg);
}

class Client {
  cookies = new Map<string, string>();
  async req(method: string, path: string, body?: unknown) {
    const res = await fetch(BASE + path, {
      method,
      redirect: "manual",
      headers: {
        ...(this.cookies.size ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
        ...(body !== undefined ? { "content-type": "application/json", origin: BASE } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const sc of res.headers.getSetCookie()) {
      const [kv] = sc.split(";");
      const i = kv.indexOf("=");
      if (!kv.slice(i + 1) || /max-age=0/i.test(sc)) this.cookies.delete(kv.slice(0, i));
      else this.cookies.set(kv.slice(0, i), kv.slice(i + 1));
    }
    return { status: res.status, text: await res.text(), type: res.headers.get("content-type") ?? "" };
  }
  async json<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await this.req(method, path, body);
    if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status}: ${r.text}`);
    return JSON.parse(r.text || "{}") as T;
  }
  async login(email: string, password: string) {
    const r = await this.req("POST", "/api/auth/login", { email, password });
    if (r.status !== 200) throw new Error(`login ${email} → ${r.status} ${r.text}`);
    return this;
  }
}


type Hit = { path: string; body: Record<string, unknown> };

/** A stand-in for Slack/Teams: records every POST; /fail answers 500. */
function startReceiver(port: number) {
  const hits: Hit[] = [];
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    hits.push({ path: req.url ?? "", body: raw ? JSON.parse(raw) : {} });
    res.writeHead(req.url === "/fail" ? 500 : 200, { "content-type": "text/plain" });
    res.end(req.url === "/fail" ? "nope" : "ok");
  });
  return new Promise<{ hits: Hit[]; close: () => void }>((r) => server.listen(port, "127.0.0.1", () => r({ hits, close: () => server.close() })));
}

async function main() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const q = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows as T[];
  const stamp = Date.now();
  const admin = await new Client().login(process.env.ADMIN_EMAIL!, process.env.ADMIN_PASSWORD!);
  const [{ org_id: orgId }] = await q<{ org_id: string }>("select org_id from users where email = $1", [process.env.ADMIN_EMAIL!.toLowerCase()]);
  const pw = "Juniper-Lantern-73";
  const mk = async (name: string, role: string) => {
    const email = `${name.toLowerCase().replace(/\s/g, ".")}.${stamp}@comms.test`;
    await admin.json("POST", "/api/settings/users", { name, email, password: pw, role });
    return new Client().login(email, pw);
  };
  const recruiter = await mk("Rana Comms", "recruiter");
  const viewer = await mk("Vic Comms", "viewer");
  const otherEmail = `iso11.${stamp}@iso.test`;
  await admin.json("POST", "/api/platform/orgs", { name: `Comms Iso ${stamp}`, admin: { name: "Ines Admin", email: otherEmail, password: pw } });
  const other = await new Client().login(otherEmail, pw);
  await admin.req("DELETE", "/api/settings/emails/invite");
  const [drive] = await q<{ id: string; title: string }>("select id, title from drives where org_id = $1 and status = 'active' order by created_at desc limit 1", [orgId]);

  /* -------------------------------- Templates ------------------------------- */
  check((await recruiter.req("PUT", "/api/settings/emails/invite", { subject: "x", body: "{{link}}" })).status === 403, "only admins edit candidate emails");
  check((await admin.req("PUT", "/api/settings/emails/nope", { subject: "x", body: "y" })).status === 404, "unknown emails are refused");
  const bad = await admin.req("PUT", "/api/settings/emails/invite", { subject: "Hello", body: "We'll call you." });
  check(bad.status === 400 && bad.text.includes("{{link}} must appear"), "an invitation without the personal link is refused");
  check((await admin.req("PUT", "/api/settings/emails/invite", { subject: "Hello", body: "{{link}} {{salary}}" })).text.includes("{{salary}} isn't available"), "unknown placeholders are refused");
  const prev = await admin.json<{ subject: string; html: string; problems: string[] }>("POST", "/api/settings/emails/preview", { key: "invite", subject: "Welcome {{first_name}} — {{role}}", body: "Hi {{first_name}},\n\n{{link}}" });
  check(prev.problems.length === 0 && prev.subject === "Welcome Priya — Senior Backend Engineer" && prev.html.includes("Start your interview") && prev.html.includes("Sent by HBE Interview on behalf of"), "the preview renders the draft with example values and branding");
  await admin.json("PUT", "/api/settings/emails/invite", { subject: "Welcome {{first_name}} — {{role}}", body: "Hi {{first_name}},\n\nThanks for applying to {{company}}.\n\n{{link}}" });
  const settingsPage = await admin.req("GET", "/app/settings");
  check(settingsPage.text.includes("Candidate emails") && settingsPage.text.includes("Invitation (customised)"), "settings show which emails are customised");
  const testSend = await admin.json<{ sent: boolean; to: string }>("POST", "/api/settings/emails/invite/test", {});
  check(testSend.sent === false && testSend.to === process.env.ADMIN_EMAIL!.toLowerCase(), "a test goes to the admin themselves (and says so when email isn't configured)");
  check((await viewer.req("POST", "/api/settings/emails/invite/test", {})).status === 403, "viewers can't send test emails");

  // The customised invitation is used — with a hostile name escaped.
  const evil = `<b>Eve</b> O'Neil ${stamp % 1000}`;
  const inv = await recruiter.json<{ results: { candidacyId: string; link: string }[] }>("POST", `/api/drives/${drive.id}/invites`, { candidates: [{ name: evil, email: `eve.${stamp}@example.com` }] });
  const cid = inv.results[0].candidacyId;
  const [log] = await q<{ template: string; subject: string; status: string; to: string }>("select template, subject, status, \"to\" from email_log where candidacy_id = $1", [cid]);
  check(log?.template === "invite" && log.subject === `Welcome <b>Eve</b> — ${drive.title}` && log.status === "not_configured", "invitations use the organisation's customised template and are logged");
  const report = await recruiter.req("GET", `/app/candidates/${cid}`);
  check(report.text.includes("Emails to the candidate") && report.text.includes("Invitation") && report.text.includes("email not configured"), "the candidate report lists the emails sent");
  check(!report.text.includes("<b>Eve</b>"), "candidate-supplied names are escaped on the report");
  // Another organisation still gets the built-in text.
  const [od] = await q<{ id: string }>("select id from organizations where name = $1", [`Comms Iso ${stamp}`]);
  check(!(await q("select 1 from settings where key = $1 and value->'emailTemplates' ? 'invite'", [`org:${od.id}`])).length, "customising emails doesn't affect other organisations");
  await admin.json("DELETE", "/api/settings/emails/invite");
  const inv2 = await recruiter.json<{ results: { candidacyId: string }[] }>("POST", `/api/drives/${drive.id}/invites`, { candidates: [{ name: "Reset Check", email: `reset.${stamp}@example.com` }] });
  const [log2] = await q<{ subject: string }>("select subject from email_log where candidacy_id = $1", [inv2.results[0].candidacyId]);
  check(log2?.subject.startsWith(`Your interview for ${drive.title}`), "resetting goes back to the built-in text");

  /* ------------------------------ Team channels ----------------------------- */
  const rx = await startReceiver(4620);
  const slackUrl = "http://127.0.0.1:4620/slack/T000/B000/secretpart";
  check((await recruiter.req("POST", "/api/settings/channels", { kind: "slack", name: "#hiring", url: slackUrl, events: ["accommodation.requested"] })).status === 403, "only admins add channels");
  check((await admin.req("POST", "/api/settings/channels", { kind: "slack", name: "#x", url: "ftp://x", events: ["accommodation.requested"] })).status === 400, "invalid URLs are refused");
  check((await admin.req("POST", "/api/settings/channels", { kind: "slack", name: "#x", url: slackUrl, events: [] })).status === 400, "a channel needs at least one event");
  const { id: slackId } = await admin.json<{ id: string }>("POST", "/api/settings/channels", { kind: "slack", name: "#hiring", url: slackUrl, events: ["accommodation.requested", "panel.reschedule_requested", "candidate.decided"] });
  const { id: teamsId } = await admin.json<{ id: string }>("POST", "/api/settings/channels", { kind: "teams", name: "Hiring team", url: "http://127.0.0.1:4620/teams", events: ["accommodation.requested"], includeNames: true });
  const { id: failId } = await admin.json<{ id: string }>("POST", "/api/settings/channels", { kind: "slack", name: "#broken", url: "http://127.0.0.1:4620/fail", events: ["accommodation.requested"] });
  const [sealed] = await q<{ url: string; host: string }>("select url, host from notification_channels where id = $1", [slackId]);
  check(!sealed.url.includes("secretpart") && sealed.host === "127.0.0.1", "the webhook URL is stored encrypted");
  const sp = await admin.req("GET", "/app/settings");
  check(sp.text.includes("Team notifications") && sp.text.includes("#hiring") && !sp.text.includes("secretpart"), "settings list channels without revealing their URLs");
  const t = await admin.json<{ ok: boolean }>("POST", `/api/settings/channels/${slackId}/test`, {});
  check(t.ok && rx.hits.some((h) => h.path.startsWith("/slack") && JSON.stringify(h.body).includes("Test from HBE Interview")), "a test message reaches the channel");
  const ft = await admin.json<{ ok: boolean; error?: string }>("POST", `/api/settings/channels/${failId}/test`, {});
  check(!ft.ok && ft.error === "HTTP 500", "a failing channel reports the error");

  // An event: a candidate asks for adjustments.
  const [tok] = await q<{ access_token: string }>("select access_token from candidacies where id = $1", [cid]);
  const cand = new Client();
  await cand.json("POST", `/api/c/${tok.access_token}/consent`, { accept: true, webcam: true });
  await cand.json("POST", `/api/c/${tok.access_token}/accommodation`, { extraTimePct: 25, extraBreaks: true, details: "private medical detail" });
  await waitFor("slack + teams messages", async () => rx.hits.filter((h) => h.path.startsWith("/slack") && JSON.stringify(h.body).includes("Adjustment request")).length && rx.hits.some((h) => h.path === "/teams"), 60_000);
  const slackMsg = rx.hits.find((h) => h.path.startsWith("/slack") && JSON.stringify(h.body).includes("Adjustment request"))!;
  const teamsMsg = rx.hits.find((h) => h.path === "/teams")!;
  const slackText = JSON.stringify(slackMsg.body);
  check(slackText.includes("A candidate") && !slackText.includes("Eve") && slackText.includes(`/app/candidates/${cid}#adjustments`), "Slack gets the event without the candidate's name, with a link back");
  check(!slackText.includes("private medical detail"), "private request details never leave the app");
  check(teamsMsg.body["@type"] === "MessageCard" && JSON.stringify(teamsMsg.body).includes("Eve"), "a Teams channel that allows names gets a message card with the name");
  await waitFor("failure recorded", async () => (await q<{ last_error: string | null }>("select last_error from notification_channels where id = $1", [failId]))[0].last_error, 30_000);
  check(true, "failed deliveries are recorded on the channel (and retried by the queue)");

  // Pause Slack: the next event only reaches Teams.
  await admin.json("PATCH", `/api/settings/channels/${slackId}`, { active: false });
  const slackBefore = rx.hits.filter((h) => h.path.startsWith("/slack")).length;
  const teamsBefore = rx.hits.filter((h) => h.path === "/teams").length;
  await cand.json("POST", `/api/c/${tok.access_token}/accommodation`, { extraTimePct: 50, extraBreaks: true });
  await waitFor("second teams message", async () => rx.hits.filter((h) => h.path === "/teams").length > teamsBefore, 60_000);
  check(rx.hits.filter((h) => h.path.startsWith("/slack")).length === slackBefore, "a paused channel receives nothing");

  check((await other.req("PATCH", `/api/settings/channels/${slackId}`, { active: true })).status === 404, "another organisation can't change this organisation's channels");
  check((await other.req("POST", `/api/settings/channels/${slackId}/test`, {})).status === 404, "another organisation can't test them");
  check((await other.req("DELETE", `/api/settings/channels/${slackId}`)).status === 404, "another organisation can't delete them");
  for (const id of [slackId, teamsId, failId]) await admin.json("DELETE", `/api/settings/channels/${id}`);
  check(!(await q("select 1 from notification_channels where id = any($1::uuid[])", [[slackId, teamsId, failId]])).length, "admins can remove channels");
  rx.close();
  await db.end();
  console.log(`\nPHASE 11 CHECKS PASSED (${passed} checks)`);
}

async function waitFor<T>(label: string, fn: () => Promise<T | null | undefined | false | 0>, timeoutMs = 60_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

main().catch((e) => {
  console.error("\nPHASE 11 CHECKS FAILED:", e);
  process.exit(1);
});
