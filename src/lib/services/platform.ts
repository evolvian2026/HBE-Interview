import { and, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { HttpError, hashPassword, type StaffUser } from "../auth/staff";
import { saveSettings } from "../settings";
import { estimateCost } from "../core/metrics";
import { slugify } from "../tenancy";
import { audit } from "../audit";

const monthStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
};

/** Estimated AI spend per organisation since `since` (from recorded token usage at list prices). */
export async function spendByOrg(since: Date) {
  const rows = await db
    .select({
      orgId: schema.aiCalls.orgId,
      model: schema.aiCalls.model,
      input: sql<number>`coalesce(sum(${schema.aiCalls.inputTokens}),0)::bigint`,
      output: sql<number>`coalesce(sum(${schema.aiCalls.outputTokens}),0)::bigint`,
      cacheRead: sql<number>`coalesce(sum(${schema.aiCalls.cacheReadTokens}),0)::bigint`,
      cacheWrite: sql<number>`coalesce(sum(${schema.aiCalls.cacheWriteTokens}),0)::bigint`,
    })
    .from(schema.aiCalls)
    .where(gte(schema.aiCalls.createdAt, since))
    .groupBy(schema.aiCalls.orgId, schema.aiCalls.model);
  const out = new Map<string, number>();
  for (const r of rows) {
    if (!r.orgId) continue;
    const cost = estimateCost(r.model, { input: Number(r.input), output: Number(r.output), cacheRead: Number(r.cacheRead), cacheWrite: Number(r.cacheWrite) });
    out.set(r.orgId, (out.get(r.orgId) ?? 0) + cost);
  }
  return out;
}

/** Month-to-date spend vs the organisation's alert budget. */
export async function orgBudget(orgId: string) {
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId));
  const spent = (await spendByOrg(monthStart())).get(orgId) ?? 0;
  const budget = org?.aiBudgetUsd ?? null;
  return { spent, budget, ratio: budget ? spent / budget : null };
}

export async function listOrgs() {
  const orgs = await db.select().from(schema.organizations).orderBy(schema.organizations.createdAt);
  const count = async (table: typeof schema.users | typeof schema.drives | typeof schema.candidacies) =>
    new Map(
      (await db.select({ orgId: table.orgId, n: sql<number>`count(*)::int` }).from(table).groupBy(table.orgId)).map((r) => [r.orgId, r.n] as const),
    );
  const [users, drives, candidacies] = await Promise.all([count(schema.users), count(schema.drives), count(schema.candidacies)]);
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const rounds = new Map(
    (
      await db
        .select({ orgId: schema.candidacies.orgId, n: sql<number>`count(*)::int` })
        .from(schema.roundSessions)
        .innerJoin(schema.candidacies, eq(schema.roundSessions.candidacyId, schema.candidacies.id))
        .where(and(eq(schema.roundSessions.status, "ended"), gte(schema.roundSessions.endedAt, since30)))
        .groupBy(schema.candidacies.orgId)
    ).map((r) => [r.orgId, r.n] as const),
  );
  const [cost30, costMonth] = await Promise.all([spendByOrg(since30), spendByOrg(monthStart())]);
  return orgs.map((o) => ({
    ...o,
    users: users.get(o.id) ?? 0,
    drives: drives.get(o.id) ?? 0,
    candidates: candidacies.get(o.id) ?? 0,
    rounds30: rounds.get(o.id) ?? 0,
    cost30: cost30.get(o.id) ?? 0,
    costMonth: costMonth.get(o.id) ?? 0,
  }));
}

export interface NewOrgInput {
  name: string;
  slug?: string;
  admin: { name: string; email: string; password: string };
}

/** Create an organisation with its first admin and default settings. */
export async function createOrg(input: NewOrgInput, by: StaffUser) {
  const slug = slugify(input.slug || input.name);
  if (slug.length < 2) throw new HttpError(400, "Choose a longer organisation name or slug");
  const email = input.admin.email.trim().toLowerCase();
  const passwordHash = await hashPassword(input.admin.password);
  const org = await db.transaction(async (tx) => {
    const [taken] = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email));
    if (taken) throw new HttpError(409, "A user with this email already exists");
    const [o] = await tx.insert(schema.organizations).values({ name: input.name.trim(), slug }).onConflictDoNothing().returning();
    if (!o) throw new HttpError(409, "That organisation slug is taken");
    await tx.insert(schema.users).values({ orgId: o.id, name: input.admin.name.trim(), email, passwordHash, role: "admin" });
    return o;
  });
  await saveSettings(org.id, { companyName: org.name });
  await audit({ type: "staff", id: by.id, orgId: org.id }, "org.create", "organization", org.id, { slug, admin: email });
  return org;
}

export async function updateOrg(orgId: string, patch: { name?: string; status?: "active" | "suspended"; aiBudgetUsd?: number | null }, by: StaffUser) {
  if (patch.status === "suspended" && orgId === by.homeOrgId) throw new HttpError(400, "You can't suspend your own organisation");
  const [o] = await db.update(schema.organizations).set(patch).where(eq(schema.organizations.id, orgId)).returning();
  if (!o) throw new HttpError(404, "Organisation not found");
  await audit({ type: "staff", id: by.id, orgId }, "org.update", "organization", orgId, patch);
  return o;
}
