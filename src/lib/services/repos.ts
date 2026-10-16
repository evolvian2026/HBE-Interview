import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { fetchRepoSnapshot, GitHubError, type RepoSnapshot } from "../github";
import { computeSignals } from "../core/authenticity";
import { analyzeRepoContent, type ParsedResume } from "../ai/analyzers";

/** Synthetic snapshot for tests/demos when GITHUB_MOCK=true (no network). */
function mockSnapshot(url: string): RepoSnapshot {
  const files = [
    { path: "README.md", content: "# Demo service\nA small order service." },
    { path: "src/server.ts", content: "import express from 'express';\nconst app = express();\napp.post('/orders', createOrder);\napp.listen(3000);" },
    { path: "src/services/orderService.ts", content: "export async function createOrder(req, res) {\n  const order = await repo.insert(req.body);\n  res.json(order);\n}" },
    { path: "src/repo/orderRepository.ts", content: "export const repo = {\n  async insert(o) { return db.query('insert into orders ...', [o]); }\n};" },
    { path: "tests/order.test.ts", content: "test('creates order', async () => {\n  expect(1).toBe(1);\n});" },
  ];
  return {
    headSha: "mock",
    tree: files.map((f) => f.path),
    files,
    facts: {
      fullName: url.replace(/^https?:\/\/github\.com\//, ""),
      fork: false,
      parentFullName: null,
      createdAt: "2025-01-01T00:00:00Z",
      pushedAt: "2025-06-01T00:00:00Z",
      sizeKb: 120,
      languages: { TypeScript: 9000 },
      sourceFileCount: 4,
      totalCommits: 42,
      candidateCommits: 40,
      activeDays: 18,
      largestCommitShare: 0.2,
      inviteCreatedAt: null,
    },
  };
}

export async function analyzeRepoJob(payload: { repositoryId: string }) {
  const [row] = await db
    .select({ repo: schema.repositories, candidacy: schema.candidacies, candidate: schema.candidates, resume: schema.resumes })
    .from(schema.repositories)
    .innerJoin(schema.candidacies, eq(schema.repositories.candidacyId, schema.candidacies.id))
    .innerJoin(schema.candidates, eq(schema.candidacies.candidateId, schema.candidates.id))
    .leftJoin(schema.resumes, eq(schema.resumes.candidacyId, schema.candidacies.id))
    .where(eq(schema.repositories.id, payload.repositoryId));
  if (!row || !row.repo.url) return;
  await db.update(schema.repositories).set({ status: "analyzing", error: null, updatedAt: new Date() }).where(eq(schema.repositories.id, row.repo.id));
  const parsed = row.resume?.parsed as ParsedResume | null;
  const project = parsed?.projects.find((p) => p.name === row.repo.projectName);
  const claimed = project?.techStack ?? [];
  let snapshot: RepoSnapshot;
  try {
    snapshot = process.env.GITHUB_MOCK === "true" ? mockSnapshot(row.repo.url) : await fetchRepoSnapshot(row.repo.url, row.candidate.githubUsername, claimed, row.candidacy.createdAt.toISOString());
  } catch (e) {
    if (e instanceof GitHubError && e.status !== 403 && e.status !== 429) {
      await db.update(schema.repositories).set({ status: "failed", error: e.message, updatedAt: new Date() }).where(eq(schema.repositories.id, row.repo.id));
      return;
    }
    throw e; // retry (rate limit / network)
  }
  const { signals, overall } = computeSignals(snapshot.facts);
  const insight = await analyzeRepoContent({
    repo: snapshot.facts.fullName,
    projectName: row.repo.projectName,
    claimedTech: claimed,
    projectDescription: project?.description ?? "",
    tree: snapshot.tree,
    files: snapshot.files,
    ctx: { candidacyId: row.candidacy.id },
  });
  // Keep only questions grounded in files we actually fetched.
  const paths = new Set(snapshot.files.map((f) => f.path));
  insight.questions = insight.questions.filter((q) => paths.has(q.filePath));
  if (insight.suspiciousInstructions.length) signals.push({ id: "injection", label: "Instruction-like text in repo", value: `${insight.suspiciousInstructions.length} occurrence(s)`, concern: "medium", explanation: insight.suspiciousInstructions.join(" | ").slice(0, 500) });
  if (insight.boilerplateLikelihood !== "low")
    signals.push({ id: "boilerplate", label: "Boilerplate similarity (AI judgement)", value: insight.boilerplateLikelihood, concern: insight.boilerplateLikelihood === "high" ? "medium" : "low", explanation: insight.boilerplateNote });
  await db
    .update(schema.repositories)
    .set({
      status: "ready",
      analysis: { facts: snapshot.facts, signals, overall, insight, headSha: snapshot.headSha, analyzedAt: new Date().toISOString() },
      questions: insight.questions,
      updatedAt: new Date(),
    })
    .where(eq(schema.repositories.id, row.repo.id));
}

export async function analyzeRepoFailed(payload: { repositoryId: string; error?: string }) {
  await db
    .update(schema.repositories)
    .set({ status: "failed", error: "We couldn't analyse this repository (GitHub unavailable or rate-limited).", updatedAt: new Date() })
    .where(eq(schema.repositories.id, payload.repositoryId));
}
