import { eq, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { brandVars, HEX } from "./core/brand";
import { getSettings } from "./settings";

export interface Branding {
  name: string;
  logoUrl: string | null;
  brandColor: string | null;
  /** CSS custom properties re-theming brand-* utilities (empty when no colour is set). */
  style: Record<string, string>;
}

/** An organisation's candidate-facing branding (logo URL is versioned by content hash for caching). */
export async function getBranding(orgId: string): Promise<Branding> {
  const [o] = await db
    .select({ id: schema.organizations.id, brandColor: schema.organizations.brandColor, logoV: sql<string | null>`substr(md5(${schema.organizations.logo}), 1, 10)` })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, orgId));
  const name = (await getSettings(orgId)).companyName;
  const color = o?.brandColor && HEX.test(o.brandColor) ? o.brandColor : null;
  return { name, logoUrl: o?.logoV ? `/api/public/orgs/${orgId}/logo?v=${o.logoV}` : null, brandColor: color, style: color ? brandVars(color) : {} };
}
