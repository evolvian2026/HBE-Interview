import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/lib/db";
import { candidacyByToken } from "@/lib/auth/candidate";
import type { DriveConfig } from "@/lib/core/types";
import { getSettings } from "@/lib/settings";
import { getBranding } from "@/lib/branding";
import { InterviewRoom } from "@/components/room/room";
import { LIMITS } from "@/lib/core/interview";
import { PRACTICE_INDEX, practiceRound } from "@/lib/core/practice";
import { practiceSession } from "@/lib/services/practice";

export const dynamic = "force-dynamic";

export default async function PracticePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const row = await candidacyByToken(token);
  if (!row) redirect(`/c/${token}`);
  const settings = await getSettings(row.candidacy.orgId);
  const session = await practiceSession(row.candidacy.id);
  const available = settings.practiceEnabled && ["ready", "round_available"].includes(row.candidacy.stage);
  // An active practice can be rejoined; a finished one is replaced when the candidate starts again from the lobby.
  if (!available && session?.status !== "active") redirect(`/c/${token}`);
  const [version] = await db.select().from(schema.driveVersions).where(eq(schema.driveVersions.id, row.candidacy.driveVersionId));
  const config = version.config as DriveConfig;
  const round = practiceRound(config);
  const brand = await getBranding(row.candidacy.orgId);
  return (
    <div style={brand.style as React.CSSProperties}>
      <InterviewRoom
        practice
        brand={{ name: brand.name, logoUrl: brand.logoUrl }}
        token={token}
        roundIndex={PRACTICE_INDEX}
        roundLabel="Practice interview"
        roundType={round.type}
        durationMin={round.durationMin}
        extraTimePct={0}
        pauses={{ count: LIMITS.maxPauses, minutes: Math.round(LIMITS.maxPauseSec / 60) }}
        sections={round.sections.map((s) => s.title)}
        personaName={round.personaName}
        companyName={settings.companyName}
        hasExercises={false}
        initialSessionId={session?.status === "active" ? session.id : null}
        languages={config.languages ?? ["en"]}
        webcam={null}
      />
    </div>
  );
}
