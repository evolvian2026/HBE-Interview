import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireStaffPage } from "@/lib/auth/staff";
import { getSettings } from "@/lib/settings";
import { PageHeader } from "@/components/ui";
import { SecurityPanel } from "@/components/staff/security-panel";

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const user = await requireStaffPage("viewer", { allowEnrollment: true });
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
  const required = (await getSettings(u.orgId)).require2fa;
  return (
    <div className="space-y-6">
      <PageHeader title="Security" subtitle={`Sign-in protection for ${u.email}`} />
      <SecurityPanel has2fa={!!u.totpEnabledAt} required={required} mustEnroll={user.mustEnroll2fa} recoveryLeft={u.recoveryCodes.length} passwordChangedAt={u.passwordChangedAt?.toISOString() ?? null} />
    </div>
  );
}
