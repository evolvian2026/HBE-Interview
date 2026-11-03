import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { requireStaffPage } from "@/lib/auth/staff";
import { db, schema } from "@/lib/db";
import { enabledRounds } from "@/lib/core/rounds";
import { PARAMETERS } from "@/lib/core/rubrics";
import { ROUND_LABEL, type DriveConfig } from "@/lib/core/types";
import { Card, PageHeader } from "@/components/ui";
import { WrittenCaseForm } from "@/components/staff/test-bench";

export const dynamic = "force-dynamic";

export default async function NewCasePage() {
  const user = await requireStaffPage("admin");
  const drives = await db
    .select({ id: schema.drives.id, title: schema.drives.title })
    .from(schema.drives)
    .where(and(eq(schema.drives.orgId, user.orgId), inArray(schema.drives.status, ["active", "draft", "paused"])))
    .orderBy(desc(schema.drives.createdAt))
    .limit(100);
  const options = [];
  for (const d of drives) {
    const [v] = await db.select({ config: schema.driveVersions.config }).from(schema.driveVersions).where(eq(schema.driveVersions.driveId, d.id)).orderBy(desc(schema.driveVersions.version)).limit(1);
    if (!v) continue;
    const rounds = enabledRounds(v.config as DriveConfig).map((r) => ({
      type: r.type,
      label: ROUND_LABEL[r.type],
      params: PARAMETERS[r.type].filter((p) => (r.weights[p.id] ?? 0) > 0).map((p) => ({ id: p.id, label: p.label })),
    }));
    if (rounds.length) options.push({ id: d.id, title: d.title, rounds });
  }
  return (
    <>
      <Link href="/app/test-bench" className="text-sm text-brand-600 hover:underline">
        ← Test bench
      </Link>
      <PageHeader title="Write a test case" subtitle="Type a short interview and the scores your team agrees it deserves. Useful before you have real interviews, or to cover a situation you want the AI to get right (e.g. a confident but shallow answer)." />
      <Card>{options.length ? <WrittenCaseForm drives={options} /> : <p className="text-sm text-slate-600">Create a hiring drive first: a written case uses a drive's role profile and rubric.</p>}</Card>
    </>
  );
}
