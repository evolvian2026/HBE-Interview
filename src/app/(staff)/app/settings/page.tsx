import { asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireStaffPage } from "@/lib/auth/staff";
import { getSettings } from "@/lib/settings";
import { PageHeader } from "@/components/ui";
import { SettingsForm } from "@/components/staff/settings-form";
import { KnowledgeBase } from "@/components/staff/knowledge-base";
import { UsersAdmin } from "@/components/staff/users-admin";
import { IntegrationsAdmin } from "@/components/staff/integrations-admin";
import { recentDeliveries } from "@/lib/services/integrations";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const me = await requireStaffPage("admin");
  const settings = await getSettings(me.orgId);
  const kb = await db.select({ id: schema.kbDocuments.id, title: schema.kbDocuments.title, content: schema.kbDocuments.content }).from(schema.kbDocuments).where(eq(schema.kbDocuments.orgId, me.orgId)).orderBy(asc(schema.kbDocuments.title));
  const users = await db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.users.role, active: schema.users.active, driveIds: schema.users.driveIds, platformAdmin: schema.users.platformAdmin }).from(schema.users).where(eq(schema.users.orgId, me.orgId)).orderBy(asc(schema.users.name));
  const drives = await db.select({ id: schema.drives.id, title: schema.drives.title }).from(schema.drives).where(eq(schema.drives.orgId, me.orgId)).orderBy(asc(schema.drives.title));
  const keys = await db
    .select({ id: schema.apiKeys.id, name: schema.apiKeys.name, prefix: schema.apiKeys.prefix, scopes: schema.apiKeys.scopes, lastUsedAt: schema.apiKeys.lastUsedAt, revokedAt: schema.apiKeys.revokedAt, createdAt: schema.apiKeys.createdAt })
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.orgId, me.orgId))
    .orderBy(desc(schema.apiKeys.createdAt));
  const hooks = await db.select({ id: schema.webhooks.id, url: schema.webhooks.url, events: schema.webhooks.events, active: schema.webhooks.active }).from(schema.webhooks).where(eq(schema.webhooks.orgId, me.orgId)).orderBy(desc(schema.webhooks.createdAt));
  const deliveries = await recentDeliveries(me.orgId, 15);
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" subtitle="Company profile, values, HR knowledge base, compliance, users and integrations." />
      <SettingsForm initial={settings} />
      <KnowledgeBase docs={kb.map((d) => ({ id: d.id, title: d.title, size: d.content.length, preview: d.content.slice(0, 200) }))} />
      <UsersAdmin users={users} drives={drives} meId={me.id} />
      <IntegrationsAdmin
        keys={keys.map((k) => ({ ...k, lastUsedAt: iso(k.lastUsedAt), revokedAt: iso(k.revokedAt), createdAt: k.createdAt.toISOString() }))}
        hooks={hooks}
        deliveries={deliveries.map(({ d, url }) => ({ id: d.id, url, event: d.event, status: d.status, attempts: d.attempts, responseStatus: d.responseStatus, error: d.error, createdAt: d.createdAt.toISOString() }))}
      />
    </div>
  );
}
