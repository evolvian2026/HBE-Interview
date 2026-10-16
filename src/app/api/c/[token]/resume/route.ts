import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireCandidacy } from "@/lib/auth/candidate";
import { HttpError } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { enqueue } from "@/lib/jobs/queue";
import { detectResumeType, RESUME_MAX_BYTES, RESUME_MIME } from "@/lib/parse";
import { ParsedResumeSchema } from "@/lib/ai/analyzers";
import { needsProjectsStep } from "@/lib/services/candidacy";
import type { DriveConfig } from "@/lib/core/types";

type Ctx = { params: Promise<{ token: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { token } = await params;
  const { candidacy } = await requireCandidacy(token);
  const [r] = await db.select().from(schema.resumes).where(eq(schema.resumes.candidacyId, candidacy.id));
  if (!r) return json({ status: "none" });
  return json({ status: r.status, error: r.error, fileName: r.fileName, profile: r.parsed });
});

/** Upload (or replace) the resume — multipart field "file". */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { token } = await params;
  const { candidacy } = await requireCandidacy(token);
  if (candidacy.stage !== "onboarding") throw new HttpError(409, "Your profile is already confirmed");
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Please choose a file");
  if (file.size > RESUME_MAX_BYTES) throw new HttpError(400, "File is larger than 5 MB");
  const bytes = Buffer.from(await file.arrayBuffer());
  const kind = detectResumeType(file.name, bytes);
  if (!kind) throw new HttpError(400, "Please upload a PDF, DOCX, PNG or JPEG file");
  const mime = RESUME_MIME[kind];
  const values = { fileName: file.name, mimeType: mime, fileData: bytes, rawText: null, status: "uploaded" as const, error: null, ocrUsed: false, parsed: null, edits: null, jdMatch: null, claims: null, riskSignals: null, updatedAt: new Date() };
  const [r] = await db
    .insert(schema.resumes)
    .values({ candidacyId: candidacy.id, ...values })
    .onConflictDoUpdate({ target: schema.resumes.candidacyId, set: values })
    .returning();
  await enqueue("parse-resume", { resumeId: r.id }, { singletonKey: `resume:${r.id}` });
  return json({ ok: true });
});

/** Confirm the (optionally edited) parsed profile. */
export const PUT = handle(async (req: Request, { params }: Ctx) => {
  const { token } = await params;
  const { candidacy } = await requireCandidacy(token);
  if (candidacy.stage !== "onboarding") throw new HttpError(409, "Your profile is already confirmed");
  const [r] = await db.select().from(schema.resumes).where(eq(schema.resumes.candidacyId, candidacy.id));
  if (!r || r.status !== "parsed") throw new HttpError(409, "Your resume is not ready yet");
  const profile = ParsedResumeSchema.parse((await req.json()).profile);
  if (!profile.experience.length && !profile.projects.length) throw new HttpError(400, "Add at least one experience or project entry");
  const before = r.parsed as typeof profile;
  const edits = {
    skillsAdded: profile.skills.map((s) => s.name).filter((n) => !before.skills.some((b) => b.name === n)),
    skillsRemoved: before.skills.map((s) => s.name).filter((n) => !profile.skills.some((b) => b.name === n)),
    projectsAdded: profile.projects.map((p) => p.name).filter((n) => !before.projects.some((b) => b.name === n)),
    projectsRemoved: before.projects.map((p) => p.name).filter((n) => !profile.projects.some((b) => b.name === n)),
    summaryChanged: before.summary !== profile.summary,
  };
  await db.update(schema.resumes).set({ parsed: profile, edits, status: "confirmed", confirmedAt: new Date(), updatedAt: new Date() }).where(eq(schema.resumes.id, r.id));
  const [v] = await db.select().from(schema.driveVersions).where(eq(schema.driveVersions.id, candidacy.driveVersionId));
  if (!needsProjectsStep(v.config as DriveConfig)) {
    await db.update(schema.candidacies).set({ stage: "ready", updatedAt: new Date() }).where(eq(schema.candidacies.id, candidacy.id));
  }
  return json({ ok: true });
});
