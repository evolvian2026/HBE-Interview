import { env } from "../env";
import type { RepoFacts } from "../core/authenticity";
import type { RepoFileSample } from "../ai/analyzers";

export interface ParsedRepoUrl {
  owner: string;
  repo: string;
  branch?: string;
  subPath?: string;
}

export function parseRepoUrl(url: string): ParsedRepoUrl | null {
  const m = url.trim().match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9-_.]+)\/([A-Za-z0-9-_.]+?)(?:\.git)?(?:\/tree\/([^/]+)(?:\/(.+?))?)?\/?$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], branch: m[3], subPath: m[4] };
}

export class GitHubError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function gh<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "hbe-interview",
      ...(env.githubToken ? { authorization: `Bearer ${env.githubToken}` } : {}),
    },
  });
  if (res.status === 404) throw new GitHubError(404, "Repository not found or not public");
  if (res.status === 403 || res.status === 429) throw new GitHubError(res.status, "GitHub rate limit reached — will retry");
  if (!res.ok) throw new GitHubError(res.status, `GitHub API error ${res.status}`);
  return (await res.json()) as T;
}

interface RepoMeta {
  full_name: string;
  fork: boolean;
  parent?: { full_name: string };
  created_at: string;
  pushed_at: string;
  size: number;
  default_branch: string;
  private: boolean;
}

const SKIP = /(^|\/)(node_modules|dist|build|out|vendor|\.next|\.git|target|bin|obj|coverage|__pycache__|\.venv|venv)(\/|$)|\.(min\.js|lock|png|jpe?g|gif|svg|ico|pdf|zip|jar|woff2?|ttf|mp4|mp3|exe|dll|so|class|pyc)$|package-lock\.json|yarn\.lock|pnpm-lock\.yaml/i;
const SOURCE = /\.(ts|tsx|js|jsx|mjs|py|java|kt|go|rs|rb|php|cs|cpp|cc|c|h|hpp|swift|scala|sql|vue|svelte|dart)$/i;

export function scorePath(p: string, claimed: string[]): number {
  if (SKIP.test(p)) return -1;
  const lower = p.toLowerCase();
  const base = lower.split("/").pop() ?? lower;
  let s = 0;
  if (/^readme/.test(base)) s += 10;
  if (/^(package\.json|pom\.xml|build\.gradle|requirements\.txt|pyproject\.toml|go\.mod|cargo\.toml|dockerfile|docker-compose\.ya?ml)$/.test(base)) s += 10;
  if (/^(main|index|app|server|application)\.[a-z]+$/.test(base) || lower.includes("cmd/")) s += 8;
  if (/(^|\/)(src|app|lib|services?|controllers?|models?|api|routes|handlers|core|domain)\//.test(lower)) s += 6;
  if (/test|spec|__tests__/.test(lower)) s += 4;
  if (SOURCE.test(lower)) s += 3;
  for (const c of claimed) if (c.length > 2 && lower.includes(c.toLowerCase())) s += 2;
  return s;
}

export interface RepoSnapshot {
  facts: RepoFacts;
  tree: string[];
  files: RepoFileSample[];
  headSha: string;
}

/** Fetch metadata, tree, a sample of key files and commit stats for a public repository. */
export async function fetchRepoSnapshot(url: string, githubUsername: string | null, claimed: string[], inviteCreatedAt: string | null): Promise<RepoSnapshot> {
  const parsed = parseRepoUrl(url);
  if (!parsed) throw new GitHubError(400, "Not a valid GitHub repository URL");
  const meta = await gh<RepoMeta>(`/repos/${parsed.owner}/${parsed.repo}`);
  if (meta.private) throw new GitHubError(403, "Only public repositories are supported");
  if (meta.size > 500_000 && !parsed.subPath) throw new GitHubError(413, "Repository is very large — please link a sub-folder (…/tree/<branch>/<path>)");
  const branch = parsed.branch ?? meta.default_branch;
  const branchInfo = await gh<{ commit: { sha: string } }>(`/repos/${parsed.owner}/${parsed.repo}/branches/${encodeURIComponent(branch)}`);
  const headSha = branchInfo.commit.sha;
  const treeRes = await gh<{ tree: { path: string; type: string; size?: number }[]; truncated: boolean }>(
    `/repos/${parsed.owner}/${parsed.repo}/git/trees/${headSha}?recursive=1`,
  );
  let blobs = treeRes.tree.filter((t) => t.type === "blob");
  if (parsed.subPath) blobs = blobs.filter((b) => b.path.startsWith(parsed.subPath!.replace(/\/$/, "") + "/"));
  const tree = blobs.map((b) => b.path).slice(0, 10_000);
  const languages = await gh<Record<string, number>>(`/repos/${parsed.owner}/${parsed.repo}/languages`).catch(() => ({}));

  // Select files: ranked by heuristic, max 8 per directory, ≤ 60 files, ≤ ~150k tokens (≈ 600 KB).
  const perDir = new Map<string, number>();
  const ranked = blobs
    .filter((b) => (b.size ?? 0) < 100_000)
    .map((b) => ({ b, s: scorePath(b.path, claimed) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  const chosen: typeof blobs = [];
  let bytes = 0;
  for (const { b } of ranked) {
    const dir = b.path.split("/").slice(0, -1).join("/");
    if ((perDir.get(dir) ?? 0) >= 8) continue;
    if (chosen.length >= 60 || bytes + (b.size ?? 0) > 600_000) break;
    perDir.set(dir, (perDir.get(dir) ?? 0) + 1);
    chosen.push(b);
    bytes += b.size ?? 0;
  }
  const files: RepoFileSample[] = [];
  for (const b of chosen) {
    try {
      const res = await fetch(`https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${headSha}/${b.path.split("/").map(encodeURIComponent).join("/")}`);
      if (!res.ok) continue;
      const text = await res.text();
      // Sanitise: strip zero-width chars; keep content otherwise verbatim for grounding.
      files.push({ path: b.path, content: text.replace(/[​-‍﻿]/g, "").slice(0, 20_000) });
    } catch {
      /* skip unreadable file */
    }
  }

  // Commit stats (up to 300 commits) + sampled commit sizes for history shape.
  const commits: { sha: string; author: { login: string } | null; commit: { author: { email: string; date: string } } }[] = [];
  for (let page = 1; page <= 3; page++) {
    const batch = await gh<typeof commits>(`/repos/${parsed.owner}/${parsed.repo}/commits?sha=${headSha}&per_page=100&page=${page}`).catch(() => []);
    commits.push(...batch);
    if (batch.length < 100) break;
  }
  const user = githubUsername?.toLowerCase() ?? "";
  const emails = new Set(commits.filter((c) => c.author?.login?.toLowerCase() === user).map((c) => c.commit.author.email.toLowerCase()));
  const mine = commits.filter((c) => (user && c.author?.login?.toLowerCase() === user) || emails.has(c.commit.author.email.toLowerCase()));
  const days = new Set(commits.map((c) => c.commit.author.date.slice(0, 10)));
  let largestShare = 0;
  const sample = commits.slice(0, 20);
  if (sample.length) {
    const sizes: number[] = [];
    for (const c of sample) {
      const d = await gh<{ stats?: { total: number } }>(`/repos/${parsed.owner}/${parsed.repo}/commits/${c.sha}`).catch(() => ({ stats: { total: 0 } }));
      sizes.push(d.stats?.total ?? 0);
    }
    const total = sizes.reduce((a, b) => a + b, 0);
    largestShare = total ? Math.max(...sizes) / total : 0;
  }
  const dates = commits.map((c) => c.commit.author.date).sort();
  return {
    headSha,
    tree,
    files,
    facts: {
      fullName: meta.full_name,
      fork: meta.fork,
      parentFullName: meta.parent?.full_name ?? null,
      createdAt: meta.created_at,
      pushedAt: meta.pushed_at,
      sizeKb: meta.size,
      languages,
      sourceFileCount: tree.filter((p) => SOURCE.test(p)).length,
      totalCommits: commits.length,
      candidateCommits: mine.length,
      activeDays: days.size,
      firstCommitAt: dates[0] ?? null,
      lastCommitAt: dates[dates.length - 1] ?? null,
      largestCommitShare: largestShare,
      inviteCreatedAt,
    },
  };
}
