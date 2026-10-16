import { eq } from "drizzle-orm";
import { db, schema } from "./db";

/** The organisation that pre-Phase-4 data was migrated into (see drizzle/0004_phase4_tenancy.sql). */
export const DEFAULT_ORG_ID = "00000000-0000-4000-8000-000000000001";

export async function ensureDefaultOrg() {
  await db.insert(schema.organizations).values({ id: DEFAULT_ORG_ID, name: "HBE", slug: "default" }).onConflictDoNothing();
}

export async function getOrg(orgId: string) {
  const [o] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId));
  return o ?? null;
}

/** Organisation of a candidacy (candidate-facing entry points resolve the tenant through their token). */
export async function orgOfCandidacy(candidacyId: string) {
  const [c] = await db.select({ orgId: schema.candidacies.orgId }).from(schema.candidacies).where(eq(schema.candidacies.id, candidacyId));
  return c?.orgId ?? null;
}

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
