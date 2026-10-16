import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { Card, Logo } from "@/components/ui";
import { RegisterForm } from "@/components/candidate/register-form";
import { enabledRounds } from "@/lib/core/rounds";
import { ROUND_LABEL, type DriveConfig } from "@/lib/core/types";

export const dynamic = "force-dynamic";

export default async function OpenInvitePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [drive] = await db.select().from(schema.drives).where(eq(schema.drives.openSlug, slug));
  const settings = await getSettings();
  const active = drive && drive.status === "active" && drive.currentVersionId;
  let rounds: string[] = [];
  if (active) {
    const [v] = await db.select().from(schema.driveVersions).where(eq(schema.driveVersions.id, drive.currentVersionId!));
    rounds = enabledRounds(v.config as DriveConfig).map((r) => `${ROUND_LABEL[r.type]} · ~${r.durationMin} min`);
  }
  return (
    <main className="mx-auto max-w-lg px-4 py-12">
      <div className="mb-8 flex justify-center">
        <Logo />
      </div>
      {!active ? (
        <Card>
          <p className="text-sm text-slate-600">This interview link is not active. Please contact the recruiter.</p>
        </Card>
      ) : (
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-brand-600">{settings.companyName}</p>
          <h1 className="mt-1 text-xl font-semibold">{drive.title}</h1>
          {settings.companyBlurb && <p className="mt-2 text-sm text-slate-600">{settings.companyBlurb}</p>}
          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
            <p className="font-medium">Your interview has {rounds.length} round{rounds.length > 1 ? "s" : ""}, conducted by an AI interviewer:</p>
            <ul className="mt-1 list-disc pl-5">
              {rounds.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
          <RegisterForm slug={slug} />
        </Card>
      )}
    </main>
  );
}
