import { eq } from "drizzle-orm";
import Link from "next/link";
import { db, schema } from "@/lib/db";
import { candidacyByToken } from "@/lib/auth/candidate";
import { getSettings } from "@/lib/settings";
import { candidateRounds, needsProjectsStep } from "@/lib/services/candidacy";
import type { DriveConfig } from "@/lib/core/types";
import type { ParsedResume } from "@/lib/ai/analyzers";
import { Badge, Card, Logo, cx } from "@/components/ui";
import { ConsentStep } from "@/components/candidate/consent-step";
import { ResumeStep } from "@/components/candidate/resume-step";
import { ProfileStep } from "@/components/candidate/profile-step";
import { ProjectsStep } from "@/components/candidate/projects-step";
import { FeedbackSurvey } from "@/components/candidate/feedback-survey";
import { pendingSurveyRound, type ReleasedFeedback } from "@/lib/services/feedback";

export const dynamic = "force-dynamic";

const ROUND_STATUS: Record<string, { label: string; tone: "green" | "blue" | "amber" | "slate" | "red" }> = {
  completed: { label: "Completed", tone: "green" },
  in_progress: { label: "In progress", tone: "blue" },
  available: { label: "Available now", tone: "blue" },
  under_review: { label: "Unlocks after review", tone: "amber" },
  locked: { label: "Locked", tone: "slate" },
  expired: { label: "Expired", tone: "red" },
};

export default async function CandidateHub({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const row = await candidacyByToken(token);
  if (!row) return <Shell><Card><p className="text-sm text-slate-600">This link is not valid. Please check the link in your email or contact the recruiter.</p></Card></Shell>;
  const { candidacy, candidate } = row;
  const [drive] = await db.select().from(schema.drives).where(eq(schema.drives.id, candidacy.driveId));
  const [version] = await db.select().from(schema.driveVersions).where(eq(schema.driveVersions.id, candidacy.driveVersionId));
  const config = version.config as DriveConfig;
  const settings = await getSettings(candidacy.orgId);
  const [resume] = await db.select().from(schema.resumes).where(eq(schema.resumes.candidacyId, candidacy.id));
  const rounds = await candidateRounds(candidacy, config);
  const needsProjects = needsProjectsStep(config);
  const surveyRound = await pendingSurveyRound(candidacy.id);
  const released = candidacy.feedbackReleasedAt ? (candidacy.feedbackSummary as ReleasedFeedback | null) : null;

  const steps = [
    { key: "consent", label: "Consent", done: candidacy.stage !== "invited" },
    { key: "resume", label: "Resume", done: !!resume && ["parsed", "confirmed"].includes(resume.status) },
    { key: "profile", label: "Profile", done: resume?.status === "confirmed" },
    ...(needsProjects ? [{ key: "projects", label: "Projects", done: !["invited", "onboarding"].includes(candidacy.stage) }] : []),
    { key: "rounds", label: "Interview", done: ["completed", "shortlisted"].includes(candidacy.stage) },
  ];

  let body: React.ReactNode;
  if (candidacy.stage === "declined") body = <p className="text-sm text-slate-600">You declined consent, so this interview can&apos;t continue. If this was a mistake, please contact the recruiter.</p>;
  else if (candidacy.stage === "expired" && !rounds.some((r) => r.status === "completed")) body = <p className="text-sm text-slate-600">This invitation has expired. Please contact the recruiter{settings.supportEmail ? ` at ${settings.supportEmail}` : ""}.</p>;
  else if (candidacy.stage === "invited") body = <ConsentStep token={token} text={settings.consentText} companyName={settings.companyName} webcamRequired={!!config.proctoring?.webcam} />;
  else if (candidacy.stage === "onboarding" && (!resume || ["uploaded", "parsing", "failed"].includes(resume.status)))
    body = <ResumeStep token={token} initialStatus={resume?.status ?? "none"} initialError={resume?.error} />;
  else if (candidacy.stage === "onboarding" && resume?.status === "parsed") body = <ProfileStep token={token} profile={resume.parsed as ParsedResume} />;
  else if (candidacy.stage === "onboarding" && resume?.status === "confirmed") {
    const prof = resume.parsed as ParsedResume;
    const links: Record<string, string> = {};
    for (const p of prof.projects) {
      const gh = [...p.links, ...prof.links].find((l) => /(github\.com|gitlab\.com|bitbucket\.org)\/[^/]+\/[^/\s]+/.test(l));
      if (gh && p.links.includes(gh)) links[p.name] = gh;
    }
    body = <ProjectsStep token={token} projects={prof.projects.map((p) => p.name).filter(Boolean)} githubUsername={candidate.githubUsername ?? prof.githubUsername ?? ""} links={links} />;
  } else {
    const done = ["completed", "shortlisted", "rejected"].includes(candidacy.stage);
    body = (
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Your interview rounds</h2>
          <p className="text-sm text-slate-600">
            {done
              ? "You've completed your interview. Thank you! The hiring team will review it and get back to you."
              : config.schedulingMode === "single"
                ? "All rounds run one after another. Take a short break between rounds if you need one."
                : "Each round is a separate session. The next round unlocks after the hiring team reviews the previous one — we'll email you."}
          </p>
        </div>
        <ol className="space-y-3">
          {rounds.map((r) => {
            const st = ROUND_STATUS[r.status];
            const canEnter = r.status === "available" || r.status === "in_progress";
            return (
              <li key={r.index} className={cx("rounded-xl border p-4", canEnter ? "border-brand-200 bg-brand-50/40" : "border-slate-200")}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      Round {r.index + 1}: {r.label}
                    </p>
                    <p className="text-xs text-slate-500">
                      ~{r.durationMin} min · {r.sections.join(" · ")}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge tone={st.tone}>{st.label}</Badge>
                    {canEnter && (
                      <Link href={`/c/${token}/round/${r.index}`} className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700">
                        {r.status === "in_progress" ? "Rejoin" : "Start round"}
                      </Link>
                    )}
                  </div>
                </div>
                {r.type === "hr" && r.status === "available" && <p className="mt-2 text-xs text-slate-600">Tip: have your notice period and earliest joining date ready.</p>}
              </li>
            );
          })}
        </ol>
        {surveyRound != null && <FeedbackSurvey token={token} roundIndex={surveyRound} roundLabel={rounds[surveyRound]?.label} />}
        {released && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
            <h3 className="font-semibold">Feedback from the hiring team</h3>
            {released.strengths.length > 0 && (
              <>
                <p className="mt-2 text-sm font-medium text-slate-700">What went well</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
                  {released.strengths.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </>
            )}
            {released.growthAreas.length > 0 && (
              <>
                <p className="mt-3 text-sm font-medium text-slate-700">Areas to develop</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
                  {released.growthAreas.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </>
            )}
            {released.note && <p className="mt-3 text-sm text-slate-600">{released.note}</p>}
          </div>
        )}
        {candidacy.roundAvailableUntil && candidacy.stage === "round_available" && (
          <p className="text-xs text-slate-500">Please take your next round before {candidacy.roundAvailableUntil.toDateString()}.</p>
        )}
      </div>
    );
  }

  return (
    <Shell>
      <div className="mb-6">
        <p className="text-xs font-medium uppercase tracking-wide text-brand-600">{settings.companyName}</p>
        <h1 className="text-xl font-semibold">{drive.title}</h1>
        <p className="text-sm text-slate-500">Hi {candidate.name.split(" ")[0]} — bookmark this page; it&apos;s your personal link to your interview.</p>
      </div>
      <ol className="mb-6 flex flex-wrap gap-2 text-xs">
        {steps.map((s, i) => (
          <li key={s.key} className={cx("rounded-full px-3 py-1", s.done ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600")}>
            {i + 1}. {s.label} {s.done && "✓"}
          </li>
        ))}
      </ol>
      <Card>{body}</Card>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8">
        <Logo />
      </div>
      {children}
    </main>
  );
}
