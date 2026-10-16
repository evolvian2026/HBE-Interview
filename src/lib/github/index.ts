/**
 * Public repository ingestion for GitHub, GitLab and Bitbucket (D-4, D-10).
 * Each host adapter produces the same RepoSnapshot: metadata facts, file tree, a sample of key files, commit stats.
 */
import { env } from "../env";
import type { RepoFacts } from "../core/authenticity";
import type { RepoFileSample } from "../ai/analyzers";

export type GitHost = "github" | "gitlab" | "bitbucket";

export interface ParsedRepoUrl {
  host: GitHost;
  owner: string;
  repo: string;
  branch?: string;
  subPath?: string;
}

export function parseRepoUrl(url: string): ParsedRepoUrl | null {
  const u = url.trim();
  const gh = u.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9-_.]+)\/([A-Za-z0-9-_.]+?)(?:\.git)?(?:\/tree\/([^/]+)(?:\/(.+?))?)?\/?$/);
  if (gh) return { host: "github", owner: gh[1], repo: gh[2], branch: gh[3], subPath: gh[4] };
  // GitLab supports nested groups: gitlab.com/group/sub/project[/-/tree/branch/path]
  const gl = u.match(/^(?:https?:\/\/)?(?:www\.)?gitlab\.com\/((?:[A-Za-z0-9-_.]+\/)+?)([A-Za-z0-9-_.]+?)(?:\.git)?(?:\/-\/tree\/([^/]+)(?:\/(.+?))?)?\/?$/);
  if (gl) return { host: "gitlab", owner: gl[1].replace(/\/$/, ""), repo: gl[2], branch: gl[3], subPath: gl[4] };
  const bb = u.match(/^(?:https?:\/\/)?(?:www\.)?bitbucket\.org\/([A-Za-z0-9-_.]+)\/([A-Za-z0-9-_.]+?)(?:\.git)?(?:\/src\/([^/]+)(?:\/(.+?))?)?\/?$/);
  if (bb) return { host: "bitbucket", owner: bb[1], repo: bb[2], branch: bb[3], subPath: bb[4] };
  return null;
}

export class GitHubError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
export { GitHubError as GitError };

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, { headers: { "user-agent": "hbe-interview", accept: "application/json", ...headers } });
  if (res.status === 404) throw new GitHubError(404, "Repository not found or not public");
  if (res.status === 401 || res.status === 403 || res.status === 429) throw new GitHubError(res.status === 401 ? 403 : res.status, "Rate limit or access restriction — will retry");
  if (!res.ok) throw new GitHubError(res.status, `Repository host API error ${res.status}`);
  return (await res.json()) as T;
}

async function getText(url: string, headers: Record<string, string> = {}): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "user-agent": "hbe-interview", ...headers } });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/* ------------------------------ Shared helpers ----------------------------- */

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

/** Rank files, ≤ 8 per directory, ≤ 60 files, ≤ ~600 KB. */
export function selectFiles(blobs: { path: string; size?: number }[], claimed: string[]) {
  const perDir = new Map<string, number>();
  const ranked = blobs
    .filter((b) => (b.size ?? 0) < 100_000)
    .map((b) => ({ b, s: scorePath(b.path, claimed) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  const chosen: { path: string; size?: number }[] = [];
  let bytes = 0;
  for (const { b } of ranked) {
    const dir = b.path.split("/").slice(0, -1).join("/");
    if ((perDir.get(dir) ?? 0) >= 8) continue;
    if (chosen.length >= 60 || bytes + (b.size ?? 0) > 600_000) break;
    perDir.set(dir, (perDir.get(dir) ?? 0) + 1);
    chosen.push(b);
    bytes += b.size ?? 4000;
  }
  return chosen;
}

const clean = (t: string) => t.replace(/[​-‍﻿]/g, "").slice(0, 20_000);

interface CommitInfo {
  login?: string | null;
  name: string;
  email: string;
  date: string;
  changes?: number;
}

/** Attribute commits to the candidate by host login, or by name/email matching the username (GitLab/Bitbucket). */
export function commitStats(commits: CommitInfo[], username: string | null) {
  const user = (username ?? "").toLowerCase();
  const byLogin = (c: CommitInfo) => !!user && c.login?.toLowerCase() === user;
  const emails = new Set(commits.filter(byLogin).map((c) => c.email.toLowerCase()));
  const mine = commits.filter(
    (c) =>
      byLogin(c) ||
      emails.has(c.email.toLowerCase()) ||
      (!!user && (c.email.toLowerCase().split("@")[0] === user || c.name.toLowerCase().replace(/\s+/g, "") === user.replace(/[-_.]/g, ""))),
  );
  const sized = commits.filter((c) => typeof c.changes === "number").slice(0, 50);
  const total = sized.reduce((a, c) => a + (c.changes ?? 0), 0);
  const dates = commits.map((c) => c.date).sort();
  return {
    totalCommits: commits.length,
    candidateCommits: mine.length,
    activeDays: new Set(commits.map((c) => c.date.slice(0, 10))).size,
    largestCommitShare: total ? Math.max(...sized.map((c) => c.changes ?? 0)) / total : 0,
    firstCommitAt: dates[0] ?? null,
    lastCommitAt: dates[dates.length - 1] ?? null,
  };
}

export interface RepoSnapshot {
  facts: RepoFacts;
  tree: string[];
  files: RepoFileSample[];
  headSha: string;
}

function subFilter<T extends { path: string }>(blobs: T[], subPath?: string) {
  return subPath ? blobs.filter((b) => b.path.startsWith(subPath.replace(/\/$/, "") + "/")) : blobs;
}

/* --------------------------------- GitHub ---------------------------------- */

async function github(p: ParsedRepoUrl, username: string | null, claimed: string[], inviteCreatedAt: string | null): Promise<RepoSnapshot> {
  const h = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", ...(env.githubToken ? { authorization: `Bearer ${env.githubToken}` } : {}) };
  const api = (path: string) => getJson<any>(`https://api.github.com${path}`, h); // eslint-disable-line @typescript-eslint/no-explicit-any
  const meta = await api(`/repos/${p.owner}/${p.repo}`);
  if (meta.private) throw new GitHubError(403, "Only public repositories are supported");
  if (meta.size > 500_000 && !p.subPath) throw new GitHubError(413, "Repository is very large — please link a sub-folder (…/tree/<branch>/<path>)");
  const branch = p.branch ?? meta.default_branch;
  const headSha: string = (await api(`/repos/${p.owner}/${p.repo}/branches/${encodeURIComponent(branch)}`)).commit.sha;
  const treeRes = await api(`/repos/${p.owner}/${p.repo}/git/trees/${headSha}?recursive=1`);
  const blobs = subFilter((treeRes.tree as { path: string; type: string; size?: number }[]).filter((t) => t.type === "blob"), p.subPath);
  const languages = await api(`/repos/${p.owner}/${p.repo}/languages`).catch(() => ({}));
  const files: RepoFileSample[] = [];
  for (const b of selectFiles(blobs, claimed)) {
    const t = await getText(`https://raw.githubusercontent.com/${p.owner}/${p.repo}/${headSha}/${b.path.split("/").map(encodeURIComponent).join("/")}`);
    if (t != null) files.push({ path: b.path, content: clean(t) });
  }
  const raw: { sha: string; author: { login: string } | null; commit: { author: { name: string; email: string; date: string } } }[] = [];
  for (let page = 1; page <= 3; page++) {
    const batch = await api(`/repos/${p.owner}/${p.repo}/commits?sha=${headSha}&per_page=100&page=${page}`).catch(() => []);
    raw.push(...batch);
    if (batch.length < 100) break;
  }
  const commits: CommitInfo[] = raw.map((c) => ({ login: c.author?.login, name: c.commit.author.name, email: c.commit.author.email, date: c.commit.author.date }));
  for (let i = 0; i < Math.min(20, raw.length); i++) {
    const d = await api(`/repos/${p.owner}/${p.repo}/commits/${raw[i].sha}`).catch(() => ({ stats: { total: 0 } }));
    commits[i].changes = d.stats?.total ?? 0;
  }
  const tree = blobs.map((b) => b.path).slice(0, 10_000);
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
      sourceFileCount: tree.filter((x) => SOURCE.test(x)).length,
      ...commitStats(commits, username),
      inviteCreatedAt,
    },
  };
}

/* --------------------------------- GitLab ---------------------------------- */

async function gitlab(p: ParsedRepoUrl, username: string | null, claimed: string[], inviteCreatedAt: string | null): Promise<RepoSnapshot> {
  const id = encodeURIComponent(`${p.owner}/${p.repo}`);
  const api = (path: string) => getJson<any>(`https://gitlab.com/api/v4/projects/${id}${path}`); // eslint-disable-line @typescript-eslint/no-explicit-any
  const meta = await api("?statistics=false");
  if (meta.visibility && meta.visibility !== "public") throw new GitHubError(403, "Only public repositories are supported");
  const branch = p.branch ?? meta.default_branch;
  const headSha: string = (await api(`/repository/branches/${encodeURIComponent(branch)}`)).commit.id;
  const blobs: { path: string; size?: number }[] = [];
  for (let page = 1; page <= 20; page++) {
    const batch: { path: string; type: string }[] = await api(`/repository/tree?recursive=true&per_page=100&page=${page}&ref=${headSha}${p.subPath ? `&path=${encodeURIComponent(p.subPath)}` : ""}`).catch(() => []);
    blobs.push(...batch.filter((b) => b.type === "blob").map((b) => ({ path: b.path })));
    if (batch.length < 100) break;
  }
  const languages = await api("/languages").catch(() => ({}));
  const files: RepoFileSample[] = [];
  for (const b of selectFiles(blobs, claimed)) {
    const t = await getText(`https://gitlab.com/api/v4/projects/${id}/repository/files/${encodeURIComponent(b.path)}/raw?ref=${headSha}`);
    if (t != null) files.push({ path: b.path, content: clean(t) });
  }
  const raw: { author_name: string; author_email: string; committed_date: string; stats?: { total: number } }[] = [];
  for (let page = 1; page <= 3; page++) {
    const batch = await api(`/repository/commits?ref_name=${headSha}&per_page=100&page=${page}&with_stats=true`).catch(() => []);
    raw.push(...batch);
    if (batch.length < 100) break;
  }
  const commits: CommitInfo[] = raw.map((c) => ({ name: c.author_name, email: c.author_email, date: c.committed_date, changes: c.stats?.total }));
  const tree = blobs.map((b) => b.path).slice(0, 10_000);
  return {
    headSha,
    tree,
    files,
    facts: {
      fullName: meta.path_with_namespace,
      fork: !!meta.forked_from_project,
      parentFullName: meta.forked_from_project?.path_with_namespace ?? null,
      createdAt: meta.created_at,
      pushedAt: meta.last_activity_at,
      sizeKb: 0,
      languages,
      sourceFileCount: tree.filter((x) => SOURCE.test(x)).length,
      ...commitStats(commits, username),
      inviteCreatedAt,
    },
  };
}

/* -------------------------------- Bitbucket -------------------------------- */

async function bitbucket(p: ParsedRepoUrl, username: string | null, claimed: string[], inviteCreatedAt: string | null): Promise<RepoSnapshot> {
  const base = `https://api.bitbucket.org/2.0/repositories/${p.owner}/${p.repo}`;
  const meta = await getJson<any>(base); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (meta.is_private) throw new GitHubError(403, "Only public repositories are supported");
  const branch = p.branch ?? meta.mainbranch?.name ?? "main";
  const headSha: string = (await getJson<any>(`${base}/refs/branches/${encodeURIComponent(branch)}`)).target.hash; // eslint-disable-line @typescript-eslint/no-explicit-any
  const blobs: { path: string; size?: number }[] = [];
  let next: string | null = `${base}/src/${headSha}/${p.subPath ? encodeURI(p.subPath) + "/" : ""}?max_depth=12&pagelen=100`;
  for (let i = 0; next && i < 30; i++) {
    const page: { values: { path: string; type: string; size?: number }[]; next?: string } = await getJson(next);
    blobs.push(...page.values.filter((v) => v.type === "commit_file").map((v) => ({ path: v.path, size: v.size })));
    next = page.next ?? null;
  }
  const files: RepoFileSample[] = [];
  for (const b of selectFiles(blobs, claimed)) {
    const t = await getText(`${base}/src/${headSha}/${b.path.split("/").map(encodeURIComponent).join("/")}`);
    if (t != null) files.push({ path: b.path, content: clean(t) });
  }
  const commits: CommitInfo[] = [];
  let cnext: string | null = `${base}/commits/${headSha}?pagelen=100`;
  for (let i = 0; cnext && i < 3; i++) {
    const page: { values: { hash: string; date: string; author: { raw: string; user?: { nickname?: string } } }[]; next?: string } = await getJson(cnext);
    for (const c of page.values) {
      const m = c.author.raw.match(/^(.*?)\s*<([^>]+)>/);
      commits.push({ login: c.author.user?.nickname ?? null, name: m?.[1] ?? c.author.raw, email: m?.[2] ?? "", date: c.date });
    }
    cnext = page.next ?? null;
  }
  const tree = blobs.map((b) => b.path).slice(0, 10_000);
  return {
    headSha,
    tree,
    files,
    facts: {
      fullName: meta.full_name,
      fork: !!meta.parent,
      parentFullName: meta.parent?.full_name ?? null,
      createdAt: meta.created_on,
      pushedAt: meta.updated_on,
      sizeKb: Math.round((meta.size ?? 0) / 1024),
      languages: meta.language ? { [meta.language]: 1 } : {},
      sourceFileCount: tree.filter((x) => SOURCE.test(x)).length,
      ...commitStats(commits, username),
      inviteCreatedAt,
    },
  };
}

/** Fetch metadata, tree, key files and commit stats for a public repository on any supported host. */
export async function fetchRepoSnapshot(url: string, username: string | null, claimed: string[], inviteCreatedAt: string | null): Promise<RepoSnapshot> {
  const parsed = parseRepoUrl(url);
  if (!parsed) throw new GitHubError(400, "Not a supported repository URL (GitHub, GitLab or Bitbucket)");
  if (parsed.host === "gitlab") return gitlab(parsed, username, claimed, inviteCreatedAt);
  if (parsed.host === "bitbucket") return bitbucket(parsed, username, claimed, inviteCreatedAt);
  return github(parsed, username, claimed, inviteCreatedAt);
}
