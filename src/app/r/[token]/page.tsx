import { resolveShareLink, isUnlocked, recordShareView } from "@/lib/services/share";
import { ReportDocument } from "@/components/report/report-document";
import { PasscodeForm } from "@/components/report/passcode-form";
import { PrintButton } from "@/components/report/print-button";
import { Card, Logo } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SharedReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await resolveShareLink(token);
  if (!link)
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <Logo />
        <Card className="mt-6">
          <p className="text-sm text-slate-600">This link is invalid, expired or has been revoked. Ask the hiring team for a new one.</p>
        </Card>
      </main>
    );
  if (!(await isUnlocked(link)))
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <Logo />
        <Card className="mt-6">
          <PasscodeForm token={token} />
        </Card>
      </main>
    );
  await recordShareView(link.id, link.candidacyId);
  return (
    <main className="min-h-screen bg-slate-100 py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-3 flex max-w-4xl items-center justify-between px-4 print:hidden">
        <Logo />
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span>Shared read-only report · expires {link.expiresAt.toLocaleDateString()}</span>
          <PrintButton />
        </div>
      </div>
      <ReportDocument candidacyId={link.candidacyId} masked={link.masked} />
    </main>
  );
}
