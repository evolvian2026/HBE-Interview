import { lookup } from "node:dns/promises";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { env } from "../env";
import { HttpError, isUuid, type StaffUser } from "../auth/staff";
import { audit } from "../audit";
import { enqueue } from "../jobs/queue";
import { seal, unseal } from "../security/secrets";
import { isInternalHost } from "../core/webhook-sign";
import { CHANNEL_EVENT_KEYS, channelPayload, channelUrlProblem, type ChannelEvent, type ChannelKind, type ChannelMessage } from "../core/notifications";

export interface ChannelInput {
  kind: ChannelKind;
  name: string;
  url: string;
  events: ChannelEvent[];
  includeNames: boolean;
}

export async function listChannels(orgId: string) {
  const rows = await db.select().from(schema.notificationChannels).where(eq(schema.notificationChannels.orgId, orgId)).orderBy(desc(schema.notificationChannels.createdAt));
  return rows.map(({ url: _url, ...r }) => r); // the URL is a credential: never sent back
}

export async function createChannel(user: StaffUser, input: ChannelInput) {
  const problem = channelUrlProblem(input.kind, input.url, env.isProduction);
  if (problem) throw new HttpError(400, problem);
  const u = new URL(input.url);
  if (env.isProduction && isInternalHost(u.hostname)) throw new HttpError(400, "That URL points to an internal address.");
  const events = input.events.filter((e) => CHANNEL_EVENT_KEYS.includes(e));
  if (!events.length) throw new HttpError(400, "Choose at least one event.");
  const count = (await db.select({ id: schema.notificationChannels.id }).from(schema.notificationChannels).where(eq(schema.notificationChannels.orgId, user.orgId))).length;
  if (count >= 10) throw new HttpError(400, "An organisation can have up to 10 channels.");
  const [row] = await db
    .insert(schema.notificationChannels)
    .values({ orgId: user.orgId, kind: input.kind, name: input.name.trim(), url: seal(input.url), host: u.hostname, events, includeNames: input.includeNames, createdBy: user.id })
    .returning({ id: schema.notificationChannels.id });
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "settings.channel_create", "notification_channel", row.id, { kind: input.kind, host: u.hostname, events });
  return row.id;
}

async function own(user: StaffUser, id: string) {
  const [c] = isUuid(id) ? await db.select().from(schema.notificationChannels).where(eq(schema.notificationChannels.id, id)) : [];
  if (!c || c.orgId !== user.orgId) throw new HttpError(404, "Channel not found");
  return c;
}

export async function updateChannel(user: StaffUser, id: string, patch: { active?: boolean; events?: ChannelEvent[]; includeNames?: boolean }) {
  await own(user, id);
  const events = patch.events?.filter((e) => CHANNEL_EVENT_KEYS.includes(e));
  if (events && !events.length) throw new HttpError(400, "Choose at least one event.");
  await db
    .update(schema.notificationChannels)
    .set({ ...(patch.active != null ? { active: patch.active } : {}), ...(events ? { events } : {}), ...(patch.includeNames != null ? { includeNames: patch.includeNames } : {}) })
    .where(eq(schema.notificationChannels.id, id));
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "settings.channel_update", "notification_channel", id, patch);
}

export async function deleteChannel(user: StaffUser, id: string) {
  await own(user, id);
  await db.delete(schema.notificationChannels).where(eq(schema.notificationChannels.id, id));
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "settings.channel_delete", "notification_channel", id);
}

async function post(channel: typeof schema.notificationChannels.$inferSelect, m: ChannelMessage) {
  const url = unseal(channel.url);
  if (env.isProduction) {
    // Re-check at send time: a public hostname may resolve to an internal address (DNS rebinding).
    const addrs = await lookup(new URL(url).hostname, { all: true });
    if (addrs.some((a) => isInternalHost(a.address))) throw new Error("Channel host resolves to an internal address");
  }
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "user-agent": "HBE-Interview-Notifications/1" }, body: JSON.stringify(channelPayload(channel.kind, m)), signal: AbortSignal.timeout(10_000), redirect: "manual" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/** Send a test message now (not queued) and report the result. */
export async function testChannel(user: StaffUser, id: string) {
  const c = await own(user, id);
  try {
    await post(c, { title: "Test from HBE Interview", text: `This channel will receive: ${c.events.join(", ")}.`, link: `${env.appBaseUrl.replace(/\/$/, "")}/app/settings#notifications` });
    await db.update(schema.notificationChannels).set({ lastDeliveredAt: new Date(), lastError: null }).where(eq(schema.notificationChannels.id, id));
    return { ok: true as const };
  } catch (e) {
    const error = (e as Error).message.slice(0, 300);
    await db.update(schema.notificationChannels).set({ lastError: error }).where(eq(schema.notificationChannels.id, id));
    return { ok: false as const, error };
  }
}

/* ------------------------------ Sending events ---------------------------- */

const appUrl = (path: string) => `${env.appBaseUrl.replace(/\/$/, "")}${path}`;

/**
 * Queue a notification on every active channel subscribed to the event. `build` gets whether the channel may name the
 * candidate. Never throws into the caller.
 */
export async function notifyChannels(orgId: string, event: ChannelEvent, build: (includeNames: boolean) => ChannelMessage) {
  try {
    const channels = (await db.select().from(schema.notificationChannels).where(and(eq(schema.notificationChannels.orgId, orgId), eq(schema.notificationChannels.active, true)))).filter((c) => c.events.includes(event));
    for (const c of channels) {
      const m = build(c.includeNames);
      await enqueue("notify-channel", { channelId: c.id, event, ...m }, { maxAttempts: 4 });
    }
  } catch (e) {
    console.error("notifyChannels failed", event, e);
  }
}

/** Convenience for candidate events: "Priya Sharma" or "A candidate", plus the drive and a link to the report. */
export async function notifyAboutCandidacy(candidacyId: string, event: ChannelEvent, title: string, text: (who: string, drive: string) => string, path?: string) {
  const [row] = await db
    .select({ orgId: schema.candidacies.orgId, name: schema.candidates.name, drive: schema.drives.title })
    .from(schema.candidacies)
    .innerJoin(schema.candidates, eq(schema.candidacies.candidateId, schema.candidates.id))
    .innerJoin(schema.drives, eq(schema.candidacies.driveId, schema.drives.id))
    .where(eq(schema.candidacies.id, candidacyId));
  if (!row) return;
  await notifyChannels(row.orgId, event, (names) => ({ title, text: text(names ? row.name : "A candidate", row.drive), link: appUrl(path ?? `/app/candidates/${candidacyId}`) }));
}

export async function deliverChannelJob(payload: { channelId: string; event: string } & ChannelMessage) {
  const [c] = await db.select().from(schema.notificationChannels).where(eq(schema.notificationChannels.id, payload.channelId));
  if (!c || !c.active) return;
  try {
    await post(c, payload);
    await db.update(schema.notificationChannels).set({ lastDeliveredAt: new Date(), lastError: null }).where(eq(schema.notificationChannels.id, c.id));
  } catch (e) {
    await db.update(schema.notificationChannels).set({ lastError: (e as Error).message.slice(0, 300) }).where(eq(schema.notificationChannels.id, c.id));
    throw e; // retried with back-off by the queue
  }
}
