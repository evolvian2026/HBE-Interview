import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { requireCandidacy } from "@/lib/auth/candidate";
import { HttpError } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { enqueue } from "@/lib/jobs/queue";
import { parseRepoUrl } from "@/lib/github";

type Ctx = { params: Promise<{ token: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { token } = await params;
  const { candidacy } = await requireCandidacy(token);
  const rows = await db.select().from(schema.repositories).where(eq(schema.repositories.candidacyId, candidacy.id));
  return json({ repos: rows.map((r) => ({ id: r.id, projectName: r.projectName, url: r.url, notPublicReason: r.notPublicReason, status: r.status, error: r.error })) });
});

const Body = z.object({
  githubUsername: z.string().trim().max(60).regex(/^[A-Za-z0-9-]*$/, "Invalid GitHub username"),
  projects: z
    .array(z.object({ projectName: z.string().trim().min(1).max(200), url: z.string().trim().max(400).nullable(), notPublicReason: z.string().trim().max(400).nullable() }))
    .max(10),
});

/** Save project → repository links, queue analysis, and mark the candidate ready for Round 1. */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { token } = await params;
  const { candidacy } = await requireCandidacy(token);
  if (!["onboarding", "ready"].includes(candidacy.stage)) throw new HttpError(409, "Project links can no longer be changed");
  const body = Body.parse(await req.json());
  for (const p of body.projects) {
    if (p.url && !parseRepoUrl(p.url)) throw new HttpError(400, `"${p.url}" is not a supported repository URL (github.com, gitlab.com or bitbucket.org)`);
    if (!p.url && !p.notPublicReason) throw new HttpError(400, `Add a repository link or a reason for "${p.projectName}"`);
  }
  await db.update(schema.candidates).set({ githubUsername: body.githubUsername || null }).where(eq(schema.candidates.id, candidacy.candidateId));
  await db.delete(schema.repositories).where(eq(schema.repositories.candidacyId, candidacy.id));
  for (const p of body.projects) {
    const [r] = await db
      .insert(schema.repositories)
      .values({ candidacyId: candidacy.id, projectName: p.projectName, url: p.url, notPublicReason: p.url ? null : p.notPublicReason, status: p.url ? "queued" : "skipped" })
      .returning();
    if (p.url) await enqueue("analyze-repo", { repositoryId: r.id }, { singletonKey: `repo:${r.id}`, maxAttempts: 5 });
  }
  await db.update(schema.candidacies).set({ stage: "ready", updatedAt: new Date() }).where(eq(schema.candidacies.id, candidacy.id));
  return json({ ok: true });
});
