import { redirect } from "next/navigation";
import { candidacyByToken } from "@/lib/auth/candidate";
import { getBranding } from "@/lib/branding";
import { BrandMark } from "@/components/ui";
import { publicPaper, screeningState } from "@/lib/services/screening";
import { SECTION_LABEL } from "@/lib/content/aptitude";
import { SECTIONS } from "@/lib/core/screening";
import { ScreeningTest } from "@/components/candidate/screening-test";

export const dynamic = "force-dynamic";

export default async function ScreeningPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const row = await candidacyByToken(token);
  if (!row) redirect(`/c/${token}`);
  const s = await screeningState(row.candidacy);
  if (!s.required || row.candidacy.stage !== "onboarding" || (s.status !== "todo" && s.status !== "in_progress")) redirect(`/c/${token}`);
  const brand = await getBranding(row.candidacy.orgId);
  const sections = SECTIONS.filter((x) => (s.cfg.sections[x] ?? 0) > 0).map((x) => ({ label: SECTION_LABEL[x], n: s.cfg.sections[x] }));
  return (
    <div style={brand.style as React.CSSProperties}>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6">
          <BrandMark brand={{ name: brand.name, logoUrl: brand.logoUrl }} />
        </div>
        <ScreeningTest token={token} durationMin={s.cfg.durationMin} total={sections.reduce((n, x) => n + x.n, 0)} sections={sections} initial={s.attempt && !s.attempt.submittedAt ? publicPaper(s.attempt) : null} />
      </main>
    </div>
  );
}
