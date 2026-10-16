import { createHash, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "../db";
import { env } from "../env";
import { HttpError } from "../auth/staff";
import { enqueue } from "../jobs/queue";
import type { ApiScope, WebhookEvent } from "../integrations-shared";
import { isInternalHost, signPayload } from "../core/webhook-sign";

export { isInternalHost, signPayload };

/* --------------------------------- API keys -------------------------------- */

export { API_SCOPES, WEBHOOK_EVENTS } from "../integrations-shared";
export type { ApiScope, WebhookEvent } from "../integrations-shared";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export async function createApiKey(name: string, scopes: ApiScope[], userId: string) {
  const key = `hbe_${randomBytes(24).toString("base64url")}`;
  const [row] = await db.insert(schema.apiKeys).values({ name, prefix: key.slice(0, 12), keyHash: sha(key), scopes, createdBy: userId }).returning();
  return { id: row.id, key };
}

/** Authenticate an integration request (Authorization: Bearer hbe_…) and check its scope. */
export async function requireApiKey(req: Request, scope: ApiScope) {
  const auth = req.headers.get("authorization") ?? "";
  const key = auth.replace(/^Bearer\s+/i, "").trim();
  if (!key.startsWith("hbe_")) throw new HttpError(401, "Missing or invalid API key");
  const [row] = await db.select().from(schema.apiKeys).where(and(eq(schema.apiKeys.keyHash, sha(key)), isNull(schema.apiKeys.revokedAt)));
  if (!row) throw new HttpError(401, "Missing or invalid API key");
  if (!row.scopes.includes(scope)) throw new HttpError(403, `API key lacks scope ${scope}`);
  await db.update(schema.apiKeys).set({ lastUsedAt: new Date() }).where(eq(schema.apiKeys.id, row.id));
  return row;
}

/* --------------------------------- Webhooks -------------------------------- */


/** Reject obviously internal targets (SSRF guard); HTTPS required in production. */
export function validateWebhookUrl(raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new HttpError(400, "Invalid URL");
  }
  if (env.isProduction && u.protocol !== "https:") throw new HttpError(400, "Webhook URLs must use HTTPS");
  if (!["http:", "https:"].includes(u.protocol)) throw new HttpError(400, "Webhook URLs must be http(s)");
  if (isInternalHost(u.hostname) && env.isProduction) throw new HttpError(400, "Webhook URL points to an internal address");
  return u.toString();
}

export async function createWebhook(url: string, events: WebhookEvent[], userId: string) {
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  const [row] = await db.insert(schema.webhooks).values({ url: validateWebhookUrl(url), secret, events, createdBy: userId }).returning();
  return { id: row.id, secret };
}


/** Record an event for every subscribed webhook and queue its delivery. Never throws into the caller. */
export async function emitEvent(event: WebhookEvent, data: Record<string, unknown>) {
  try {
    const hooks = (await db.select().from(schema.webhooks).where(eq(schema.webhooks.active, true))).filter((h) => h.events.includes(event));
    for (const h of hooks) {
      const [d] = await db
        .insert(schema.webhookDeliveries)
        .values({ webhookId: h.id, event, payload: { event, createdAt: new Date().toISOString(), data } })
        .returning({ id: schema.webhookDeliveries.id });
      await enqueue("deliver-webhook", { deliveryId: d.id }, { singletonKey: `wh:${d.id}`, maxAttempts: 6 });
    }
  } catch (e) {
    console.error("emitEvent failed", event, e);
  }
}

export async function deliverWebhookJob(payload: { deliveryId: string }) {
  const [row] = await db
    .select({ d: schema.webhookDeliveries, h: schema.webhooks })
    .from(schema.webhookDeliveries)
    .innerJoin(schema.webhooks, eq(schema.webhookDeliveries.webhookId, schema.webhooks.id))
    .where(eq(schema.webhookDeliveries.id, payload.deliveryId));
  if (!row || row.d.status === "delivered" || !row.h.active) return;
  const body = JSON.stringify({ id: row.d.id, ...(row.d.payload as object) });
  const timestamp = String(Math.floor(Date.now() / 1000));
  let status: number | null = null;
  let error: string | null = null;
  try {
    if (env.isProduction) {
      // Re-check at send time: a public hostname may resolve to an internal address (DNS rebinding).
      const addrs = await lookup(new URL(row.h.url).hostname, { all: true });
      if (addrs.some((a) => isInternalHost(a.address))) throw new Error("Webhook host resolves to an internal address");
    }
    const res = await fetch(row.h.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "HBE-Interview-Webhooks/1",
        "x-hbe-event": row.d.event,
        "x-hbe-delivery": row.d.id,
        "x-hbe-timestamp": timestamp,
        "x-hbe-signature": signPayload(row.h.secret, timestamp, body),
      },
      body,
      signal: AbortSignal.timeout(10_000),
      redirect: "manual",
    });
    status = res.status;
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  await db
    .update(schema.webhookDeliveries)
    .set({ attempts: row.d.attempts + 1, responseStatus: status, error, status: error ? "pending" : "delivered", deliveredAt: error ? null : new Date() })
    .where(eq(schema.webhookDeliveries.id, row.d.id));
  if (error) throw new Error(`Webhook delivery failed: ${error}`); // queue retries with back-off
}

export async function deliverWebhookFailed(payload: { deliveryId: string }) {
  await db.update(schema.webhookDeliveries).set({ status: "failed" }).where(eq(schema.webhookDeliveries.id, payload.deliveryId));
}

export async function recentDeliveries(limit = 20) {
  return db
    .select({ d: schema.webhookDeliveries, url: schema.webhooks.url })
    .from(schema.webhookDeliveries)
    .innerJoin(schema.webhooks, eq(schema.webhookDeliveries.webhookId, schema.webhooks.id))
    .orderBy(desc(schema.webhookDeliveries.createdAt))
    .limit(limit);
}
