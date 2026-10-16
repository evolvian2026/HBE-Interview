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
      <PageHeader title="Platform" subtitle="Organisations, usage across tenants and platform-wide AI settings. Visible to platform administrators only." />
      <PlatformOrgs orgs={orgs.map((o) => ({ ...o, createdAt: o.createdAt.toISOString() }))} activeOrgId={user.orgId} homeOrgId={user.homeOrgId} />
      <PlatformModelsForm initial={await getPlatformSettings()} />
    </div>
  );
}
