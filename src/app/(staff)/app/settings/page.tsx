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
import { getSsoConfig, listDomains } from "@/lib/services/sso";
import { verificationRecord } from "@/lib/core/domain";
import { redirectUri } from "@/lib/sso/flow";
import { SsoSettings } from "@/components/staff/sso-settings";
import { BrandingSettings } from "@/components/staff/branding-settings";
import { getBranding } from "@/lib/branding";
import { Card } from "@/components/ui";
import { EmailTemplates } from "@/components/staff/email-templates";
import { PLACEHOLDERS, TEMPLATE_KEYS, TEMPLATES, type TemplateDef } from "@/lib/core/templates";
import { NotificationChannels } from "@/components/staff/notification-channels";
import { listChannels } from "@/lib/services/channels";
import { CHANNEL_EVENTS, CHANNEL_EVENT_KEYS } from "@/lib/core/notifications";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ sso_error?: string; sso_test?: string }> }) {
  const me = await requireStaffPage("admin");
  const sp = await searchParams;
  const ssoDomains = await listDomains(me.orgId);
  const ssoCfg = await getSsoConfig(me.orgId);
  const branding = await getBranding(me.orgId);
  const settings = await getSettings(me.orgId);
  const kb = await db.select({ id: schema.kbDocuments.id, title: schema.kbDocuments.title, content: schema.kbDocuments.content }).from(schema.kbDocuments).where(eq(schema.kbDocuments.orgId, me.orgId)).orderBy(asc(schema.kbDocuments.title));
  const users = await db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.users.role, active: schema.users.active, driveIds: schema.users.driveIds, platformAdmin: schema.users.platformAdmin, totpEnabledAt: schema.users.totpEnabledAt }).from(schema.users).where(eq(schema.users.orgId, me.orgId)).orderBy(asc(schema.users.name));
  const drives = await db.select({ id: schema.drives.id, title: schema.drives.title }).from(schema.drives).where(eq(schema.drives.orgId, me.orgId)).orderBy(asc(schema.drives.title));
  const keys = await db
    .select({ id: schema.apiKeys.id, name: schema.apiKeys.name, prefix: schema.apiKeys.prefix, scopes: schema.apiKeys.scopes, lastUsedAt: schema.apiKeys.lastUsedAt, revokedAt: schema.apiKeys.revokedAt, createdAt: schema.apiKeys.createdAt })
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.orgId, me.orgId))
    .orderBy(desc(schema.apiKeys.createdAt));
  const hooks = await db.select({ id: schema.webhooks.id, url: schema.webhooks.url, events: schema.webhooks.events, active: schema.webhooks.active }).from(schema.webhooks).where(eq(schema.webhooks.orgId, me.orgId)).orderBy(desc(schema.webhooks.createdAt));
  const deliveries = await recentDeliveries(me.orgId, 15);
  const channels = await listChannels(me.orgId);
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" subtitle="Company profile, values, HR knowledge base, compliance, users and integrations." />
      <SettingsForm initial={settings} />
      <KnowledgeBase docs={kb.map((d) => ({ id: d.id, title: d.title, size: d.content.length, preview: d.content.slice(0, 200) }))} />
      <UsersAdmin users={users.map((u) => ({ ...u, has2fa: !!u.totpEnabledAt, totpEnabledAt: undefined }))} drives={drives} meId={me.id} />
      <BrandingSettings name={settings.companyName} logoUrl={branding.logoUrl} brandColor={branding.brandColor} />
      <section id="emails">
        <Card title="Candidate emails">
          <EmailTemplates
            rows={TEMPLATE_KEYS.map((key) => {
              const def: TemplateDef = TEMPLATES[key];
              const custom = settings.emailTemplates?.[key];
              return {
                key,
                label: def.label,
                when: def.when,
                placeholders: def.placeholders.map((name) => ({ name, description: PLACEHOLDERS[name] })),
                required: def.required,
                subject: custom?.subject ?? def.subject,
                body: custom?.body ?? def.body,
                defaultSubject: def.subject,
                defaultBody: def.body,
                custom: !!custom,
              };
            })}
          />
        </Card>
      </section>
      <section id="notifications">
        <Card title="Team notifications (Slack / Teams)">
          <NotificationChannels
            channels={channels.map((c) => ({ id: c.id, kind: c.kind, name: c.name, host: c.host, events: c.events, includeNames: c.includeNames, active: c.active, lastDeliveredAt: c.lastDeliveredAt?.toISOString() ?? null, lastError: c.lastError }))}
            events={CHANNEL_EVENT_KEYS.map((key) => ({ key, label: CHANNEL_EVENTS[key] }))}
          />
        </Card>
      </section>
      <SsoSettings
        domains={ssoDomains.map((d) => ({ id: d.id, domain: d.domain, txt: verificationRecord(d.verificationToken), verified: !!d.verifiedAt, verifiedBy: d.verifiedBy }))}
        config={ssoCfg ? { issuer: ssoCfg.issuer, clientId: ssoCfg.clientId, enabled: ssoCfg.enabled, required: ssoCfg.required, jitRole: ssoCfg.jitRole, lastTestedAt: ssoCfg.lastTestedAt?.toISOString() ?? null, hasSecret: !!ssoCfg.clientSecret } : null}
        redirectUri={redirectUri()}
        testedEmail={sp.sso_test}
        error={sp.sso_error}
      />
      <IntegrationsAdmin
        keys={keys.map((k) => ({ ...k, lastUsedAt: iso(k.lastUsedAt), revokedAt: iso(k.revokedAt), createdAt: k.createdAt.toISOString() }))}
        hooks={hooks}
        deliveries={deliveries.map(({ d, url }) => ({ id: d.id, url, event: d.event, status: d.status, attempts: d.attempts, responseStatus: d.responseStatus, error: d.error, createdAt: d.createdAt.toISOString() }))}
      />
    </div>
  );
}
