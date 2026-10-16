/** Deterministic GitHub authenticity signals (FEATURES §7.2). Indicators, never verdicts. */

export type Concern = "none" | "low" | "medium" | "high";

export interface RepoFacts {
  fullName: string;
  fork: boolean;
  parentFullName?: string | null;
  createdAt: string;
  pushedAt: string;
  sizeKb: number;
  languages: Record<string, number>;
  sourceFileCount: number;
  totalCommits: number;
  candidateCommits: number;
  activeDays: number;
  firstCommitAt?: string | null;
  lastCommitAt?: string | null;
  largestCommitShare: number; // 0..1 share of changed lines in the largest single commit (sampled)
  inviteCreatedAt?: string | null;
}

export interface Signal {
  id: string;
  label: string;
  value: string;
  concern: Concern;
  explanation: string;
}

const order: Concern[] = ["none", "low", "medium", "high"];

export function computeSignals(f: RepoFacts): { signals: Signal[]; overall: Concern } {
  const signals: Signal[] = [];

  signals.push({
    id: "fork",
    label: "Original vs fork",
    value: f.fork ? `Fork of ${f.parentFullName ?? "another repository"}` : "Original repository",
    concern: f.fork && f.candidateCommits <= 5 ? "medium" : f.fork ? "low" : "none",
    explanation: f.fork
      ? `Forked repository with ${f.candidateCommits} commit(s) by the candidate.`
      : "Repository is not a fork.",
  });

  const share = f.totalCommits ? f.candidateCommits / f.totalCommits : 0;
  signals.push({
    id: "commit_share",
    label: "Candidate commit share",
    value: f.totalCommits ? `${Math.round(share * 100)}% of ${f.totalCommits} commits` : "No commits found",
    concern: !f.totalCommits ? "medium" : share < 0.2 ? "medium" : share < 0.5 ? "low" : "none",
    explanation: f.totalCommits
      ? `${f.candidateCommits} of ${f.totalCommits} sampled commits are attributed to the candidate's GitHub account.`
      : "No commit history could be read.",
  });

  signals.push({
    id: "history",
    label: "History shape",
    value: `${f.activeDays} active day(s); largest commit ${Math.round(f.largestCommitShare * 100)}% of changes`,
    concern: f.largestCommitShare > 0.8 && f.totalCommits > 0 ? "medium" : f.activeDays <= 1 ? "low" : "none",
    explanation:
      f.largestCommitShare > 0.8
        ? "Most of the code arrived in a single commit — could be a bulk upload of code written elsewhere (or legitimately migrated)."
        : "Changes are spread over multiple commits.",
  });

  signals.push({
    id: "size",
    label: "Code volume",
    value: `${f.sourceFileCount} source file(s)`,
    concern: f.sourceFileCount < 3 ? "low" : "none",
    explanation: f.sourceFileCount < 3 ? "Very little source code to assess." : "Enough source code to assess.",
  });

  if (f.inviteCreatedAt) {
    const days = (Date.parse(f.inviteCreatedAt) - Date.parse(f.createdAt)) / 86_400_000;
    signals.push({
      id: "timeline",
      label: "Timeline",
      value: `Created ${Math.max(0, Math.round(days))} day(s) before the invitation`,
      concern: days < 14 ? "low" : "none",
      explanation: days < 14 ? "Repository is very recent relative to the application (context only)." : "Repository predates the application.",
    });
  }

  const overall = signals.reduce<Concern>((acc, s) => (order.indexOf(s.concern) > order.indexOf(acc) ? s.concern : acc), "none");
  const mediums = signals.filter((s) => s.concern === "medium").length;
  return { signals, overall: mediums >= 2 ? "high" : overall };
}
