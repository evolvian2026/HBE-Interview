import { requireStaffPage } from "@/lib/auth/staff";
import { PageHeader } from "@/components/ui";
import { NewDriveForm } from "@/components/staff/new-drive-form";

export default async function NewDrivePage() {
  await requireStaffPage("recruiter");
  return (
    <>
      <PageHeader title="New hiring drive" subtitle="Paste the job description. The AI proposes the role profile, interview rounds and rubrics — you can adjust everything before publishing." />
      <NewDriveForm />
    </>
  );
}
