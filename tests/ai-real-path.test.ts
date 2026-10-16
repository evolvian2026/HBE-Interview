/**
 * Exercises the real (non-mock) Anthropic SDK code paths against a local stand-in for the Messages API,
 * verifying request construction (fallbacks, caching, strict tools, structured output) and the tool loop.
 * Requires a local Postgres (DATABASE_URL) because AI calls are metered to the ai_calls table.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod";

const requests: { headers: http.IncomingHttpHeaders; body: Record<string, unknown> }[] = [];
let server: http.Server;
let script: ((body: Record<string, unknown>) => string)[] = [];

function sse(events: Record<string, unknown>[]) {
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
}

function message(content: Record<string, unknown>[], stop: string) {
  const ev: Record<string, unknown>[] = [
    { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "m", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } },
  ];
  content.forEach((c, i) => {
    if (c.type === "text") {
      ev.push({ type: "content_block_start", index: i, content_block: { type: "text", text: "" } });
      ev.push({ type: "content_block_delta", index: i, delta: { type: "text_delta", text: c.text } });
    } else {
      ev.push({ type: "content_block_start", index: i, content_block: { type: "tool_use", id: c.id, name: c.name, input: {} } });
      ev.push({ type: "content_block_delta", index: i, delta: { type: "input_json_delta", partial_json: JSON.stringify(c.input) } });
    }
    ev.push({ type: "content_block_stop", index: i });
  });
  ev.push({ type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 20 } });
  ev.push({ type: "message_stop" });
  return sse(ev);
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      requests.push({ headers: req.headers, body });
      const next = script.shift();
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(next ? next(body) : message([{ type: "text", text: "fallback" }], "end_turn"));
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.AI_MOCK = "false";
  process.env.DATABASE_URL ??= "postgres://postgres@localhost:5432/hbe";
});

afterAll(async () => {
  server?.close();
  const { pool } = await import("@/lib/db");
  await pool.end();
});

describe("real AI path", () => {
  it("structured(): sends schema, fallbacks and cache control, parses and repairs output", async () => {
    const { structured } = await import("@/lib/ai/gateway");
    const schema = z.object({ answer: z.string(), n: z.number() });
    script = [
      () => message([{ type: "text", text: '{"answer": "x"}' }], "end_turn"), // invalid → repair
      () => message([{ type: "text", text: '{"answer": "ok", "n": 3}' }], "end_turn"),
    ];
    const out = await structured({ stage: "test", tier: "evaluator", system: "sys", user: "hi", schema, mock: () => ({ answer: "mock", n: 0 }) });
    expect(out).toEqual({ answer: "ok", n: 3 });
    const first = requests[requests.length - 2];
    expect(first.body.model).toBe("claude-opus-5-5");
    expect(first.body.fallbacks).toBe("default");
    expect(String(first.headers["anthropic-beta"])).toContain("server-side-fallback-2026-07-01");
    expect((first.body.output_config as { format: { type: string } }).format.type).toBe("json_schema");
    expect((first.body.system as { cache_control?: unknown }[])[0].cache_control).toEqual({ type: "ephemeral" });
    expect(first.body.temperature).toBeUndefined();
    const second = requests[requests.length - 1];
    expect(JSON.stringify(second.body.messages)).toContain("failed validation");
  });

  it("haiku stage omits server-side fallbacks", async () => {
    const { structured } = await import("@/lib/ai/gateway");
    script = [() => message([{ type: "text", text: '{"v": true}' }], "end_turn")];
    await structured({ stage: "t2", tier: "utility", system: "s", user: "u", schema: z.object({ v: z.boolean() }), mock: () => ({ v: false }) });
    const last = requests[requests.length - 1];
    expect(last.body.model).toBe("claude-haiku-5-5");
    expect(last.body.fallbacks).toBeUndefined();
  });

  it("runInterviewerTurn(): executes tools, returns results, streams final text", async () => {
    const { runInterviewerTurn } = await import("@/lib/interview/agent");
    script = [
      () =>
        message(
          [
            { type: "tool_use", id: "tu_1", name: "record_assessment", input: { parameter: "role_fit", score: 4, evidence: "I designed the cache", needs_follow_up: false, star: null } },
            { type: "tool_use", id: "tu_2", name: "advance_section", input: { reason: "covered" } },
          ],
          "tool_use",
        ),
      (body) => {
        const msgs = body.messages as { role: string; content: unknown }[];
        const lastUser = JSON.stringify(msgs[msgs.length - 1]);
        // Both tool results must be returned in a single user message.
        expect(lastUser).toContain("tu_1");
        expect(lastUser).toContain("tu_2");
        return message([{ type: "text", text: "Great. Let's talk about system design." }], "end_turn");
      },
    ];
    const calls: string[] = [];
    let streamed = "";
    const text = await runInterviewerTurn(
      {
        sessionId: "00000000-0000-0000-0000-000000000000",
        candidacyId: "00000000-0000-0000-0000-000000000000",
        round: "technical",
        persona: "Aarav",
        companyName: "HBE",
        roleTitle: "Engineer",
        seniority: "Senior",
        roleBlock: "role",
        dossierBlock: "dossier",
        history: [{ id: "1", sessionId: "s", seq: 1, role: "candidate", sectionKey: "resume", content: "I designed the cache layer", clientMsgId: null, meta: null, createdAt: new Date() }],
        liveState: "state",
        mock: { sectionKey: "resume", sectionParam: "role_fit", pool: [], instruction: "continue", canAdvance: true },
      },
      async (name) => {
        calls.push(name);
        return { content: "ok" };
      },
      (d) => (streamed += d),
    );
    expect(calls).toEqual(["record_assessment", "advance_section"]);
    expect(text).toBe("Great. Let's talk about system design.");
    expect(streamed).toBe(text);
    const req = requests[requests.length - 2].body;
    expect(req.model).toBe("claude-sonnet-5-5");
    const tools = req.tools as { name: string; strict?: boolean }[];
    expect(tools.map((t) => t.name)).toContain("give_hint");
    expect(tools.every((t) => t.strict)).toBe(true);
    expect(req.tool_choice).toBeUndefined();
    const sys = req.system as { cache_control?: unknown }[];
    expect(sys[2].cache_control).toEqual({ type: "ephemeral" });
    expect(JSON.stringify(req.messages)).toContain("<candidate_answer>");
    expect(JSON.stringify(req.messages)).toContain("<interview_state>");
  });
});
