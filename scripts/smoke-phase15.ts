/**
 * Phase 15 checks: natural voice — admin voice settings and preview, interviewer audio per message, answer
 * transcription, limits, usage, candidate isolation and the browser fallback.
 * Runs against a dev server with AI_MOCK=true and SPEECH_MOCK=true.
 *   BASE_URL=http://localhost:3000 npx tsx scripts/smoke-phase15.ts
 */
import "./load-env";
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

async function waitFor<T>(label: string, fn: () => Promise<T | null | undefined | false>, timeoutMs = 90_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

type Q = <T = Record<string, unknown>>(sql: string, args?: unknown[]) => Promise<T[]>;
const DEFAULT_VOICE = { engine: "natural", accent: "en-IN", gender: "female" };

async function main() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const q: Q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const stamp = Date.now();
  const admin = await new Client().login(process.env.ADMIN_EMAIL!, process.env.ADMIN_PASSWORD!);
  const [{ org_id: orgId }] = await q<{ org_id: string }>("select org_id from users where email = $1", [process.env.ADMIN_EMAIL!.toLowerCase()]);
  try {
    await run(admin, orgId, q, stamp);
  } finally {
    await admin.json("PUT", "/api/settings", { voice: DEFAULT_VOICE });
    await db.end();
  }
  console.log(`\nPHASE 15 CHECKS PASSED (${passed} checks)`);
}

async function raw(path: string, init: RequestInit = {}) {
  const res = await fetch(BASE + path, { ...init, headers: { origin: BASE, ...(init.headers ?? {}) } });
  return { status: res.status, type: res.headers.get("content-type") ?? "", buf: Buffer.from(await res.arrayBuffer()) };
}

async function run(admin: Client, orgId: string, q: Q, stamp: number) {
  await q("delete from rate_limits where key like 'voice-preview:%' or key like 'tts:%' or key like 'stt:%'");
  await admin.json("PUT", "/api/settings", { voice: DEFAULT_VOICE });

  /* -------------------------------- Settings -------------------------------- */
  const settings = await admin.req("GET", "/app/settings");
  check(settings.text.includes("Interviewer voice") && settings.text.includes("Natural voice uses Microsoft Azure AI Speech"), "admins see the interviewer voice settings (speech service configured)");
  const preview = await fetch(`${BASE}/api/settings/voice/preview`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, cookie: [...admin.cookies].map(([k, v]) => `${k}=${v}`).join("; ") }, body: JSON.stringify({ accent: "en-IN", gender: "male" }) });
  const pbuf = Buffer.from(await preview.arrayBuffer());
  check(preview.status === 200 && (preview.headers.get("content-type") ?? "").startsWith("audio/") && pbuf.length > 1000, "admins can play a sample of the voice");
  check((await admin.req("PUT", "/api/settings", { voice: { engine: "natural", accent: "en-AU", gender: "female" } })).status === 400, "only the listed accents can be chosen");
  const pw = "Lantern-Quarry-63";
  const recEmail = `vani.voice.${stamp}@hbe.local`;
  await admin.json("POST", "/api/settings/users", { name: "Vani Voice", email: recEmail, password: pw, role: "recruiter" });
  const recruiter = await new Client().login(recEmail, pw);
  check((await recruiter.req("POST", "/api/settings/voice/preview", { accent: "en-IN", gender: "female" })).status === 403, "only admins can preview voices");
  check((await recruiter.req("PUT", "/api/settings", { voice: { engine: "browser", accent: "en-IN", gender: "female" } })).status === 403, "only admins can change the voice");
  await admin.json("PUT", "/api/settings", { voice: { engine: "natural", accent: "en-GB", gender: "male" } });

  /* ------------------------------ Candidate side ------------------------------ */
  const [drive] = await q<{ id: string }>("select id from drives where org_id = $1 and status = 'active' order by created_at desc limit 1", [orgId]);
  const inv = await admin.json<{ results: { link: string }[] }>("POST", `/api/drives/${drive.id}/invites`, { candidates: [{ name: "Vikram Voice", email: `vikram.${stamp}@example.com` }] });
  const token = inv.results[0].link.split("/c/")[1];
  const [{ id: cid }] = await q<{ id: string }>("select id from candidacies where access_token = $1", [token]);
  await q("update candidacies set stage = 'ready', current_round_index = 0 where id = $1", [cid]);
  const cand = new Client();
  const lobby = await cand.req("GET", `/c/${token}/round/0`);
  check(lobby.text.includes("natural interviewer voice") && /\\?"locale\\?":\\?"en-GB/.test(lobby.text), "the lobby offers the natural voice, with the organisation's English accent");
  const { sessionId } = await cand.json<{ sessionId: string }>("POST", `/api/c/${token}/rounds/0/start`, { mode: "voice" });
  const base = `/api/c/${token}/sessions/${sessionId}`;
  const open = await fetch(`${BASE}${base}/turns`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ clientMsgId: crypto.randomUUID(), kind: "open", text: "", inputMode: "voice" }) });
  const sse = await open.text();
  const done = sse.split("\n\n").find((c) => c.includes("event: done"));
  const aiMessageId = done ? (JSON.parse(/data: (.*)/.exec(done)![1]) as { aiMessageId: string }).aiMessageId : "";
  check(!!aiMessageId, "the room learns the interviewer message's id when it finishes");

  const before = (await q<{ n: number }>("select count(*)::int n from speech_usage where org_id = $1", [orgId]))[0].n;
  const audio = await raw(`${base}/speech/${aiMessageId}`);
  check(audio.status === 200 && audio.type.startsWith("audio/") && audio.buf.subarray(0, 4).toString() === "RIFF", "the interviewer's message is spoken with the natural voice");
  await (await fetch(`${BASE}${base}/turns`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ clientMsgId: crypto.randomUUID(), kind: "answer", text: "I led the migration of our billing service to event sourcing and measured the error rate before and after.", inputMode: "voice" }) })).text();
  const [cmsg] = await q<{ id: string }>("select id from messages where session_id = $1 and role = 'candidate' limit 1", [sessionId]);
  const [anyAi] = await q<{ id: string }>("select m.id from messages m join round_sessions s on s.id = m.session_id where m.role = 'ai' and s.id <> $1 limit 1", [sessionId]);
  check((await raw(`${base}/speech/${crypto.randomUUID()}`)).status === 404, "only existing messages can be spoken");
  if (anyAi) check((await raw(`${base}/speech/${anyAi.id}`)).status === 404, "messages from another session can't be spoken through this one");
  check(!!cmsg && (await raw(`${base}/speech/${cmsg.id}`)).status === 404, "only the interviewer's messages are spoken");

  const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(6000, 7)]);
  const stt = await fetch(`${BASE}${base}/transcribe`, { method: "POST", headers: { "content-type": "audio/webm;codecs=opus", origin: BASE }, body: webm });
  const sttBody = (await stt.json()) as { text?: string };
  check(stt.status === 200 && (sttBody.text ?? "").includes("mock transcript"), "a recorded answer is turned into text");
  check((await raw(`${base}/transcribe`, { method: "POST", headers: { "content-type": "text/plain" }, body: "hello" })).status === 415, "only audio can be transcribed");
  check((await raw(`${base}/transcribe`, { method: "POST", headers: { "content-type": "audio/webm" }, body: Buffer.alloc(50) })).status === 400, "an empty recording is refused");
  check((await raw(`${base}/transcribe`, { method: "POST", headers: { "content-type": "audio/webm" }, body: Buffer.alloc(13 * 1024 * 1024, 1) })).status === 413, "a recording over the size limit is refused");
  const usage = await q<{ kind: string; units: number }>("select kind, units from speech_usage where org_id = $1 order by created_at desc limit 5", [orgId]);
  check((await q<{ n: number }>("select count(*)::int n from speech_usage where org_id = $1", [orgId]))[0].n >= before + 2 && usage.some((u) => u.kind === "stt") && usage.some((u) => u.kind === "tts"), "speech usage is recorded (characters and audio length only)");
  check(!(await q("select 1 from messages where session_id = $1 and content like '%mock transcript%'", [sessionId])).length, "transcribing doesn't send the answer — the candidate reviews it first");
  check((await admin.req("GET", "/app/usage?range=30")).text.includes("Natural voice (speech service)"), "the usage page shows natural voice usage and cost");

  /* --------------------------------- Isolation --------------------------------- */
  const inv2 = await admin.json<{ results: { link: string }[] }>("POST", `/api/drives/${drive.id}/invites`, { candidates: [{ name: "Other Voice", email: `other.voice.${stamp}@example.com` }] });
  const token2 = inv2.results[0].link.split("/c/")[1];
  check((await raw(`/api/c/${token2}/sessions/${sessionId}/speech/${aiMessageId}`)).status === 404, "another candidate can't play this interview's audio");
  check((await raw(`/api/c/${token2}/sessions/${sessionId}/transcribe`, { method: "POST", headers: { "content-type": "audio/webm" }, body: webm })).status === 404, "another candidate can't transcribe into this interview");

  /* ------------------------------ Browser fallback ------------------------------ */
  await admin.json("PUT", "/api/settings", { voice: { engine: "browser", accent: "en-IN", gender: "female" } });
  check((await raw(`${base}/speech/${aiMessageId}`)).status === 503, "with the browser voice chosen, the natural voice is off");
  check((await raw(`${base}/transcribe`, { method: "POST", headers: { "content-type": "audio/webm" }, body: webm })).status === 503, "with the browser voice chosen, answers use the browser's dictation");
  const lobby2 = await new Client().req("GET", `/c/${token2}`);
  check(lobby2.status === 200, "candidate pages still work with the browser voice");
  await q("update candidacies set stage = 'ready', current_round_index = 0 where access_token = $1", [token2]);
  const l2 = await new Client().req("GET", `/c/${token2}/round/0`);
  check(l2.text.includes("Voice mode available in this browser") && /\\?"natural\\?":false/.test(l2.text), "the lobby falls back to the browser's speech");
  await admin.json("PUT", "/api/settings", { voice: DEFAULT_VOICE });

  /* --------------------------------- Ended round --------------------------------- */
  await q("update round_sessions set status = 'ended' where id = $1", [sessionId]);
  check((await raw(`${base}/transcribe`, { method: "POST", headers: { "content-type": "audio/webm" }, body: webm })).status === 409, "nothing can be transcribed after the round ends");
  check((await raw(`${base}/speech/${aiMessageId}`)).status === 200, "the interviewer's last message can still be replayed after the round ends");
}

main().catch((e) => {
  console.error("\nPHASE 15 CHECKS FAILED:", e);
  process.exit(1);
});
