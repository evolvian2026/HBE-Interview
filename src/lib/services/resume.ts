import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { extractResumeText } from "../parse";
import { analyzeResume } from "../ai/analyzers";
import { transcribeResume } from "../ai/ocr";
import type { DriveConfig } from "../core/types";

export async function parseResumeJob(payload: { resumeId: string }) {
  const [row] = await db
    .select({ resume: schema.resumes, candidacy: schema.candidacies, version: schema.driveVersions, candidate: schema.candidates })
    .from(schema.resumes)
    .innerJoin(schema.candidacies, eq(schema.resumes.candidacyId, schema.candidacies.id))
    .innerJoin(schema.candidates, eq(schema.candidacies.candidateId, schema.candidates.id))
    .innerJoin(schema.driveVersions, eq(schema.candidacies.driveVersionId, schema.driveVersions.id))
    .where(eq(schema.resumes.id, payload.resumeId));
  if (!row) return;
  await db.update(schema.resumes).set({ status: "parsing", updatedAt: new Date() }).where(eq(schema.resumes.id, payload.resumeId));
  let text = row.resume.rawText ?? "";
  if (!text) {
    const extracted = await extractResumeText(row.resume.fileName, row.resume.fileData);
    text = extracted.text;
    if (extracted.pages > 10) {
      await fail(payload.resumeId, "Resume is longer than 10 pages — please upload a shorter version.");
      return;
    }
  }
  let ocrUsed = false;
  if (text.replace(/\s/g, "").length < 300 && row.resume.mimeType !== "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    // Scanned PDF or photo: transcribe with the model's document/vision input.
    const ocr = await transcribeResume(row.resume.fileData, row.resume.mimeType, { candidacyId: row.candidacy.id });
    if (!ocr.legible) {
      await fail(payload.resumeId, "We couldn't read this file as a resume. Please upload a clearer scan, or a text-based PDF or DOCX.");
      return;
    }
    text = ocr.text;
    ocrUsed = true;
  }
  if (text.replace(/\s/g, "").length < 300) {
    await fail(payload.resumeId, "We couldn't read enough text from this file. Please upload a clearer scan, or a text-based PDF or DOCX.");
    return;
  }
  const config = row.version.config as DriveConfig;
  const analysis = await analyzeResume(text, config.roleProfile, { candidacyId: row.candidacy.id });
  await db
    .update(schema.resumes)
    .set({
      rawText: text,
      ocrUsed,
      status: "parsed",
      error: null,
      parsed: analysis.profile,
      jdMatch: analysis.jdMatch,
      claims: analysis.claims,
      riskSignals: analysis.riskSignals,
      updatedAt: new Date(),
    })
    .where(eq(schema.resumes.id, payload.resumeId));
  if (analysis.profile.githubUsername && !row.candidate.githubUsername) {
    await db.update(schema.candidates).set({ githubUsername: analysis.profile.githubUsername }).where(eq(schema.candidates.id, row.candidate.id));
  }
}

async function fail(resumeId: string, error: string) {
  await db.update(schema.resumes).set({ status: "failed", error, updatedAt: new Date() }).where(eq(schema.resumes.id, resumeId));
}

export async function parseResumeFailed(payload: { resumeId: string; error?: string }) {
  await fail(payload.resumeId, "We couldn't process your resume right now. Please try uploading again.");
}
