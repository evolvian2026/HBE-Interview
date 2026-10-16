import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { db, schema } from "../db";
import { env } from "../env";

export type ModelTier = "interviewer" | "analyzer" | "evaluator" | "utility";

let client: Anthropic | null = null;

export function aiClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: env.anthropicKey, maxRetries: 3, timeout: 120_000 });
  return client;
}

export function modelFor(tier: ModelTier): string {
  return env.models[tier];
}

export function isMock() {
  return env.aiMock;
}

/** Server-side refusal fallback params (Sonnet/Opus only; Haiku has no server-side fallback). */
export function fallbackParams(model: string): { betas?: string[]; fallbacks?: "default" } {
  if (!env.aiFallbacks || model.includes("haiku")) return {};
  return { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };
}

export interface CallContext {
  sessionId?: string | null;
  candidacyId?: string | null;
}

export async function recordAiCall(
  stage: string,
  model: string,
  started: number,
  usage: Anthropic.Beta.BetaUsage | null,
  ctx: CallContext = {},
  error?: string,
) {
  try {
    await db.insert(schema.aiCalls).values({
      stage,
      model,
      inputTokens: usage?.input_tokens ?? null,
      outputTokens: usage?.output_tokens ?? null,
      cacheReadTokens: usage?.cache_read_input_tokens ?? null,
      cacheWriteTokens: usage?.cache_creation_input_tokens ?? null,
      latencyMs: Date.now() - started,
      sessionId: ctx.sessionId ?? null,
      candidacyId: ctx.candidacyId ?? null,
      error: error ?? null,
    });
  } catch (e) {
    console.error("failed to record ai call", e);
  }
}

export class AiRefusalError extends Error {}

export interface StructuredOptions<T> {
  stage: string;
  tier: ModelTier;
  system: string;
  /** User content: plain text, or content blocks when a cached prefix is useful. */
  user: string | Anthropic.Beta.BetaContentBlockParam[];
  schema: z.ZodType<T>;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens?: number;
  ctx?: CallContext;
  /** Deterministic implementation used when AI_MOCK=true. */
  mock: () => T | Promise<T>;
}

function textOf(content: Anthropic.Beta.BetaContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/**
 * JSON-schema output format derived from a Zod schema, *without* the SDK's auto-parser: the SDK would throw inside
 * the stream on a validation failure, which would bypass our repair-and-retry step below.
 */
function jsonFormat<T>(schema: z.ZodType<T>): Anthropic.Beta.BetaJSONOutputFormat {
  const f = zodOutputFormat(schema as z.ZodType<T> & z.core.$ZodType);
  return { type: f.type, schema: f.schema };
}

/** One schema-constrained model call, validated with Zod, with one repair attempt. */
export async function structured<T>(opts: StructuredOptions<T>): Promise<T> {
  if (isMock()) return await opts.mock();
  const model = modelFor(opts.tier);
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: opts.user }];
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const started = Date.now();
    let response: Anthropic.Beta.BetaMessage;
    try {
      const stream = aiClient().beta.messages.stream({
        model,
        max_tokens: opts.maxTokens ?? 16000,
        system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
        messages,
        output_config: { format: jsonFormat(opts.schema), ...(opts.effort ? { effort: opts.effort } : {}) },
        ...fallbackParams(model),
      });
      response = await stream.finalMessage();
    } catch (e) {
      await recordAiCall(opts.stage, model, started, null, opts.ctx, String(e));
      throw e;
    }
    await recordAiCall(opts.stage, model, started, response.usage, opts.ctx);
    if (response.stop_reason === "refusal") {
      throw new AiRefusalError(`Model declined (${response.stop_details?.category ?? "unknown"}) at stage ${opts.stage}`);
    }
    const text = textOf(response.content);
    try {
      const parsed = opts.schema.safeParse(JSON.parse(text));
      if (parsed.success) return parsed.data;
      lastError = JSON.stringify(parsed.error.issues).slice(0, 2000);
    } catch (e) {
      lastError = `Invalid JSON: ${String(e)}`;
    }
    messages.push({ role: "assistant", content: response.content as Anthropic.Beta.BetaContentBlockParam[] });
    messages.push({ role: "user", content: `Your output failed validation: ${lastError}\nReturn corrected JSON only.` });
  }
  throw new Error(`Structured output failed validation at stage ${opts.stage}: ${lastError}`);
}

/** Wrap untrusted content so the model treats it as data, never as instructions. */
export function untrusted(tag: string, content: string): string {
  const safe = content.replace(new RegExp(`</?${tag}>`, "gi"), "");
  return `<${tag}>\n${safe}\n</${tag}>`;
}
