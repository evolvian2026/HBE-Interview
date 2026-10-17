import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/auth/staff";
import { listOrgs } from "@/lib/services/platform";
import { getPlatformSettings } from "@/lib/settings";
import { PageHeader } from "@/components/ui";
import { PlatformOrgs } from "@/components/staff/platform-orgs";
import { PlatformModelsForm } from "@/components/staff/platform-models-form";

export const dynamic = "force-dynamic";

export default async function PlatformPage() {
  const user = await requireStaffPage();
  if (!user.platformAdmin) notFound();
  const orgs = await listOrgs();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform"
        subtitle="Organisations, usage across tenants and platform-wide AI settings. Visible to platform administrators only."
        actions={
          <Link href="/app/platform/ops" className="rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
            Operations
          </Link>
        }
      />
      <PlatformOrgs orgs={orgs.map((o) => ({ ...o, createdAt: o.createdAt.toISOString() }))} activeOrgId={user.orgId} homeOrgId={user.homeOrgId} />
      <PlatformModelsForm initial={await getPlatformSettings()} />
    </div>
  );
}
