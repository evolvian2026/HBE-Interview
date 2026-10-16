import { asc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireStaffPage } from "@/lib/auth/staff";
import { getSettings } from "@/lib/settings";
import { PageHeader } from "@/components/ui";
import { SettingsForm } from "@/components/staff/settings-form";
import { KnowledgeBase } from "@/components/staff/knowledge-base";
import { UsersAdmin } from "@/components/staff/users-admin";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const me = await requireStaffPage("admin");
  const settings = await getSettings();
  const kb = await db.select({ id: schema.kbDocuments.id, title: schema.kbDocuments.title, content: schema.kbDocuments.content }).from(schema.kbDocuments).orderBy(asc(schema.kbDocuments.title));
  const users = await db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.users.role, active: schema.users.active, driveIds: schema.users.driveIds }).from(schema.users).orderBy(asc(schema.users.name));
  const drives = await db.select({ id: schema.drives.id, title: schema.drives.title }).from(schema.drives).orderBy(asc(schema.drives.title));
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" subtitle="Company profile, values, HR knowledge base, compliance and users." />
      <SettingsForm initial={settings} />
      <KnowledgeBase docs={kb.map((d) => ({ id: d.id, title: d.title, size: d.content.length, preview: d.content.slice(0, 200) }))} />
      <UsersAdmin users={users} drives={drives} meId={me.id} />
    </div>
  );
}
