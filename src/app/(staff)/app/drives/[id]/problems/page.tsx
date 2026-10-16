import Link from "next/link";
import { desc, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { requireDrivePage, requireStaffPage } from "@/lib/auth/staff";
import { Badge, Card, PageHeader } from "@/components/ui";
import { ProblemForm, DeleteProblemButton } from "@/components/staff/problem-form";

export const dynamic = "force-dynamic";

export default async function ProblemsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaffPage("recruiter");
  const { id } = await params;
  const d = await requireDrivePage(user, id);
  const problems = await db.select().from(schema.codingProblems).where(eq(schema.codingProblems.driveId, id)).orderBy(desc(schema.codingProblems.createdAt));
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Custom coding problems — ${d.title}`}
        subtitle={
          <>
            <Link href={`/app/drives/${id}`} className="text-brand-600 hover:underline">
              ← Back to drive
            </Link>{" "}
            · Validated custom problems are used instead of the built-in bank for this drive&apos;s live coding.
          </>
        }
      />
      <Card title={`Problems (${problems.length})`}>
        {problems.length === 0 ? (
          <p className="text-sm text-slate-500">None yet — the curated bank of 12 validated problems is used.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {problems.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                <div>
                  <p className="font-medium">
                    {p.title} <Badge>{p.difficulty}</Badge> {p.validatedAt ? <Badge tone="green">validated</Badge> : <Badge tone="red">failed validation</Badge>}
                  </p>
                  <p className="text-xs text-slate-500">
                    {p.samples.length} sample + {p.hidden.length} hidden tests · reference in {p.referenceLanguage}
                    {!p.validatedAt && p.validation != null && ` · ${JSON.stringify((p.validation as { failures?: unknown[] }).failures?.slice(0, 2))}`}
                  </p>
                </div>
                <DeleteProblemButton id={p.id} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <ProblemForm driveId={id} />
    </div>
  );
}
