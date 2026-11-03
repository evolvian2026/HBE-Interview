import Link from "next/link";
import { notFound } from "next/navigation";
import { HttpError, requireStaffPage } from "@/lib/auth/staff";
import { matchDetail } from "@/lib/services/similarity";
import { Badge, Card, PageHeader, cx } from "@/components/ui";
import { MatchReview } from "@/components/staff/code-similarity";

export const dynamic = "force-dynamic";

const pct = (x: number) => `${Math.round(x * 100)}%`;

function CodeView({ code, ranges, label }: { code: string; ranges: [number, number][]; label: string }) {
  const hit = (n: number) => ranges.some(([a, b]) => n >= a && n <= b);
  const lines = code.split("\n");
  return (
    <div tabIndex={0} role="region" aria-label={label} className="max-h-[36rem] overflow-auto rounded-lg border border-slate-200 bg-white font-mono text-xs">
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className={cx(hit(i + 1) && "bg-amber-100")}>
              <td className="select-none border-r border-slate-200 px-2 text-right text-slate-600">{i + 1}</td>
              <td className="whitespace-pre px-2">{l || " "}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaffPage("recruiter");
  const { id } = await params;
  const d = await matchDetail(user, id).catch((e) => {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  });
  const { match: m, a, b } = d;
  const shared = (ranges: [number, number][]) => ranges.reduce((n, [x, y]) => n + (y - x + 1), 0);

  return (
    <>
      <Link href="/app/code-similarity" className="text-sm text-brand-600 hover:underline">
        ← Copied-code checks
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {`${pct(m.score)} similar · ${d.problemTitle}`}
            <Badge tone={m.level === "high" ? "red" : "amber"}>{m.level}</Badge>
            <Badge tone={m.status === "copied" ? "red" : m.status === "coincidence" ? "green" : "slate"}>{m.status === "open" ? "to review" : m.status === "copied" ? "likely copied" : "coincidence"}</Badge>
          </span>
        }
        subtitle="Highlighted lines share the same structure after variable names, comments, strings and layout are set aside. Short, standard solutions can match by coincidence — look at the logic, not just the percentage."
      />
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card title={`${a.name} · ${a.driveTitle}`} actions={<Link href={`/app/candidates/${a.candidacyId}`} className="text-sm text-brand-600 hover:underline">Report</Link>}>
          <p className="mb-2 text-xs text-slate-600">{`${a.language} · ${a.createdAt.toLocaleString()} · ${shared(m.linesA)} matching lines`}</p>
          <CodeView code={a.code} ranges={m.linesA} label={`Code from ${a.name}`} />
        </Card>
        <Card
          title={b.kind === "candidate" ? `${b.name} · ${b.driveTitle}` : `Known solution: ${b.source}`}
          actions={b.kind === "candidate" ? <Link href={`/app/candidates/${b.candidacyId}`} className="text-sm text-brand-600 hover:underline">Report</Link> : undefined}
        >
          <p className="mb-2 text-xs text-slate-600">{`${b.language}${b.createdAt ? ` · ${b.createdAt.toLocaleString()}` : ""} · ${shared(m.linesB)} matching lines`}</p>
          <CodeView code={b.code} ranges={m.linesB} label={b.kind === "candidate" ? `Code from ${b.name}` : "Known solution"} />
        </Card>
      </div>
      <Card title="Your conclusion">
        {m.reviewedAt && <p className="mb-3 text-sm text-slate-600">{`Last reviewed by ${d.reviewer ?? "a former user"} on ${m.reviewedAt.toLocaleString()}.`}</p>}
        <MatchReview matchId={m.id} status={m.status} note={m.reviewNote ?? ""} />
        <p className="mt-3 text-xs text-slate-600">Your conclusion is recorded and shown on both candidates' reports. It doesn't change any score; use it in the hiring decision.</p>
      </Card>
    </>
  );
}
