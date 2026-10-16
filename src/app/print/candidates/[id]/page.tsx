import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/lib/db";
import { canSeeDrive, requireStaffPage } from "@/lib/auth/staff";
import { audit } from "@/lib/audit";
import { ReportDocument } from "@/components/report/report-document";
import { PrintButton } from "@/components/report/print-button";

export const dynamic = "force-dynamic";

/** Printer-friendly report: use the browser's "Save as PDF" to export. */
export default async function PrintReportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ masked?: string; transcript?: string }> }) {
  const user = await requireStaffPage();
  const { id } = await params;
  const { masked, transcript } = await searchParams;
  const [c] = await db.select({ driveId: schema.candidacies.driveId }).from(schema.candidacies).where(eq(schema.candidacies.id, id));
  if (!c || !canSeeDrive(user, c.driveId)) notFound();
  await audit({ type: "staff", id: user.id }, "report.export", "candidacy", id, { masked: masked === "1", transcript: transcript === "1" });
  return (
    <main className="min-h-screen bg-slate-100 py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-3 flex max-w-4xl justify-end gap-2 px-4 print:hidden">
        <PrintButton autoPrint />
      </div>
      <ReportDocument candidacyId={id} masked={masked === "1"} includeTranscript={transcript === "1"} />
    </main>
  );
}
