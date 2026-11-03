import Link from "next/link";
import { requireStaffPage } from "@/lib/auth/staff";
import { similarityOverview } from "@/lib/services/similarity";
import { SIM, type LeakStatus } from "@/lib/core/similarity";
import { Badge, Card, PageHeader, cx } from "@/components/ui";
import { AddReferenceForm, RemoveReference, RetireButton, ScanPast } from "@/components/staff/code-similarity";

export const dynamic = "force-dynamic";

const LEAK: Record<LeakStatus, { label: string; tone: "red" | "amber" | "green" }> = {
  likely_leaked: { label: "likely leaked", tone: "red" },
  watch: { label: "watch", tone: "amber" },
  ok: { label: "no signs", tone: "green" },
};
const STATUS: Record<string, { label: string; tone: "slate" | "green" | "red" }> = {
  open: { label: "to review", tone: "slate" },
  coincidence: { label: "coincidence", tone: "green" },
  copied: { label: "likely copied", tone: "red" },
};
const pct = (x: number) => `${Math.round(x * 100)}%`;

export default async function CodeSimilarityPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await requireStaffPage("recruiter");
  const sp = await searchParams;
  const status = (["open", "reviewed", "all"] as const).find((s) => s === sp.status) ?? "open";
  const { matches, problems, bank } = await similarityOverview(user, { status });
  const isAdmin = user.role === "admin";

  return (
    <>
      <PageHeader
        title="Copied-code checks"
        subtitle={`Each candidate's final code is compared with other candidates' code for the same problem and language, and with known published solutions. Renamed variables, comments and reformatting don't hide a copy. Matches of ${pct(SIM.medium)} or more are listed for a person to review — they never change a score.`}
        actions={isAdmin ? <ScanPast /> : undefined}
      />

      <nav aria-label="Filter" className="mb-4 flex gap-2 text-sm">
        {(["open", "reviewed", "all"] as const).map((s) => (
          <Link key={s} href={`/app/code-similarity?status=${s}`} aria-current={s === status ? "page" : undefined} className={cx("rounded-full px-3 py-1", s === status ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700")}>
            {s === "open" ? "To review" : s === "reviewed" ? "Reviewed" : "All"}
          </Link>
        ))}
      </nav>

      <Card title={`Matches (${matches.length})`} className="mb-6">
        {matches.length === 0 ? (
          <p className="text-sm text-slate-600">{status === "open" ? "Nothing to review." : "No matches."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Similarity</th>
                  <th className="py-2 pr-3">Candidate</th>
                  <th className="py-2 pr-3">Matches</th>
                  <th className="py-2 pr-3">Problem</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {matches.map((m) => (
                  <tr key={m.id}>
                    <td className="py-2 pr-3">
                      <Link href={`/app/code-similarity/${m.id}`} className="font-semibold text-brand-600 hover:underline">
                        {pct(m.score)}
                      </Link>
                      <Badge tone={m.level === "high" ? "red" : "amber"} className="ml-2">
                        {m.level}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3">{m.a ? `${m.a.name} · ${m.a.driveTitle}` : "—"}</td>
                    <td className="py-2 pr-3">{m.b ? `${m.b.name} · ${m.b.driveTitle}` : m.reference ? `Known solution: ${m.reference.source}` : "—"}</td>
                    <td className="py-2 pr-3">{problems.find((p) => p.problemId === m.problemId)?.title ?? m.problemId}</td>
                    <td className="py-2">
                      <Badge tone={STATUS[m.status].tone}>{STATUS[m.status].label}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Coding problems" className="mb-6">
        <p className="mb-3 text-sm text-slate-600">{`A problem is marked likely leaked when ${SIM.leakCluster} or more candidates submitted near-identical code, or ${SIM.leakReferenceHits} or more matched a known published solution (matches people marked as coincidence don't count). Retired problems aren't given in new interviews.`}</p>
        {problems.length === 0 ? (
          <p className="text-sm text-slate-600">No coding submissions checked yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Problem</th>
                  <th className="py-2 pr-3">Submissions (6 months)</th>
                  <th className="py-2 pr-3">Signals</th>
                  <th className="py-2 pr-3">Known solutions</th>
                  <th className="py-2">{isAdmin ? "Use" : ""}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {problems.map((p) => (
                  <tr key={p.problemId}>
                    <td className="py-2 pr-3 align-top">
                      {p.title}
                      {p.retired && <Badge className="ml-2">retired</Badge>}
                    </td>
                    <td className="py-2 pr-3 align-top">{p.submissions}</td>
                    <td className="py-2 pr-3 align-top">
                      <Badge tone={LEAK[p.status].tone}>{LEAK[p.status].label}</Badge>
                      <span className="mt-1 block text-xs text-slate-600">{`Largest group with near-identical code: ${p.largestGroup || "—"} · matched a known solution: ${p.referenceCandidates}`}</span>
                    </td>
                    <td className="py-2 pr-3 align-top text-xs">
                      {p.references.length === 0
                        ? "—"
                        : p.references.map((r) => (
                            <span key={r.id} className="block">
                              {`${r.source} (${r.language}) `}
                              {isAdmin && <RemoveReference id={r.id} />}
                            </span>
                          ))}
                    </td>
                    <td className="py-2 align-top">{isAdmin && <RetireButton problemId={p.problemId} retired={p.retired} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {isAdmin && (
        <Card title="Add a known published solution">
          <p className="mb-3 text-sm text-slate-600">Found a solution to one of your problems online? Add it: every past and future submission for that problem is compared with it. For custom problems, the author's reference solution is included automatically.</p>
          <AddReferenceForm problems={[...bank, ...problems.filter((p) => p.problemId.startsWith("custom-")).map((p) => ({ id: p.problemId, title: p.title }))]} />
        </Card>
      )}
    </>
  );
}
