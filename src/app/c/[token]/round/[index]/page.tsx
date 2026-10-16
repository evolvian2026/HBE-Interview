import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/lib/db";
import { candidacyByToken } from "@/lib/auth/candidate";
import { enabledRounds } from "@/lib/core/rounds";
import { ROUND_LABEL, type DriveConfig } from "@/lib/core/types";
import { getSettings } from "@/lib/settings";
import { InterviewRoom } from "@/components/room/room";

export const dynamic = "force-dynamic";

export default async function RoundPage({ params }: { params: Promise<{ token: string; index: string }> }) {
  const { token, index } = await params;
  const row = await candidacyByToken(token);
  if (!row) redirect(`/c/${token}`);
  const i = Number(index);
  const [version] = await db.select().from(schema.driveVersions).where(eq(schema.driveVersions.id, row.candidacy.driveVersionId));
  const round = enabledRounds(version.config as DriveConfig)[i];
  if (!round) redirect(`/c/${token}`);
  const [session] = await db
    .select()
    .from(schema.roundSessions)
    .where(and(eq(schema.roundSessions.candidacyId, row.candidacy.id), eq(schema.roundSessions.roundIndex, i)));
  const available = i === row.candidacy.currentRoundIndex && ["ready", "round_available"].includes(row.candidacy.stage);
  if (!session && !available) redirect(`/c/${token}`);
  const settings = await getSettings(row.candidacy.orgId);
  const sections = round.sections.filter((s) => s.enabled);
  return (
    <InterviewRoom
      token={token}
      roundIndex={i}
      roundLabel={ROUND_LABEL[round.type]}
      roundType={round.type}
      durationMin={round.durationMin}
      sections={sections.map((s) => s.title)}
      personaName={round.personaName}
      companyName={settings.companyName}
      hasExercises={sections.some((s) => s.exercise && s.exercise !== "practical_fit")}
      initialSessionId={session?.id ?? null}
      languages={(version.config as DriveConfig).languages ?? ["en"]}
      webcam={(version.config as DriveConfig).proctoring?.webcam && (row.candidacy.consent as { webcam?: boolean } | null)?.webcam ? { intervalSec: (version.config as DriveConfig).proctoring!.intervalSec } : null}
    />
  );
}
