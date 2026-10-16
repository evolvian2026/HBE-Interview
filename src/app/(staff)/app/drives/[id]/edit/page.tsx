import { requireDrivePage, requireStaffPage } from "@/lib/auth/staff";
import { PageHeader } from "@/components/ui";
import { DriveEditor } from "@/components/staff/drive-editor";
import type { DriveConfig } from "@/lib/core/types";

export const dynamic = "force-dynamic";

export default async function EditDrivePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaffPage("recruiter");
  const { id } = await params;
  const d = await requireDrivePage(user, id);
  return (
    <>
      <PageHeader title={`Configure: ${d.title}`} subtitle="Review the AI's proposal. Every setting can be changed; scores and gates follow these rules." />
      <DriveEditor driveId={d.id} initial={d.draft as DriveConfig} published={!!d.currentVersionId} />
    </>
  );
}
