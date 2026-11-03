import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireStaffPage } from "@/lib/auth/staff";
import { getSettings } from "@/lib/settings";
import { PageHeader } from "@/components/ui";
import { SecurityPanel } from "@/components/staff/security-panel";
import { CalendarCard } from "@/components/staff/calendar-card";
import { calendarProviders, connectionOf } from "@/lib/services/calendar";
import { providerOf } from "@/lib/calendar/providers";

export const dynamic = "force-dynamic";

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ calendar?: string; calendar_error?: string }> }) {
  const user = await requireStaffPage("viewer", { allowEnrollment: true });
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
  const required = (await getSettings(u.orgId)).require2fa;
  const sp = await searchParams;
  const conn = user.role !== "viewer" ? await connectionOf(user.id) : null;
  return (
    <div className="space-y-6">
      <PageHeader title="Security" subtitle={`Sign-in protection for ${u.email}`} />
      <SecurityPanel has2fa={!!u.totpEnabledAt} required={required} mustEnroll={user.mustEnroll2fa} recoveryLeft={u.recoveryCodes.length} passwordChangedAt={u.passwordChangedAt?.toISOString() ?? null} />
      {user.role !== "viewer" && !user.mustEnroll2fa && (
        <CalendarCard
          providers={calendarProviders()}
          connection={conn ? { provider: conn.provider, label: providerOf(conn.provider)?.label ?? conn.provider, email: conn.accountEmail, error: conn.lastError, connectedAt: conn.connectedAt.toISOString() } : null}
          notice={sp.calendar === "connected" ? "Your calendar is connected." : ""}
          error={sp.calendar_error ?? ""}
        />
      )}
    </div>
  );
}
