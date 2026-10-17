import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireStaffPage } from "@/lib/auth/staff";
import { DELETION_DUE_DAYS } from "@/lib/services/data-rights";
import { Badge, Card, PageHeader } from "@/components/ui";
import { DataRequestActions } from "@/components/staff/data-request-actions";

export const dynamic = "force-dynamic";

const TONE = { pending: "amber", completed: "green", rejected: "slate" } as const;

export default async function DataRequestsPage() {
  const user = await requireStaffPage("admin");
  const rows = await db
    .select({ r: schema.dataRequests, by: schema.users.name })
    .from(schema.dataRequests)
    .leftJoin(schema.users, eq(schema.dataRequests.resolvedBy, schema.users.id))
    .where(eq(schema.dataRequests.orgId, user.orgId))
    .orderBy(desc(schema.dataRequests.createdAt))
    .limit(200);
  const pending = rows.filter((x) => x.r.status === "pending");
  return (
    <div className="space-y-6">
      <PageHeader
        title="Data requests"
        subtitle={`Candidates' requests to delete their data. Pending requests are fulfilled automatically ${DELETION_DUE_DAYS} days after they were made unless you decline them with a reason.`}
      />
      <Card title={`Pending (${pending.length})`}>
        {pending.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing waiting.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {pending.map(({ r }) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium">
                    {r.candidateEmail}{" "}
                    {r.candidacyId && (
                      <Link href={`/app/candidates/${r.candidacyId}`} className="text-xs font-normal text-brand-700 hover:underline">
                        view candidate
                      </Link>
                    )}
                  </p>
                  <p className="text-xs text-slate-500">
                    Requested {r.createdAt.toLocaleDateString()} · due {r.dueAt.toLocaleDateString()}
                    {r.reason && <> · &ldquo;{r.reason}&rdquo;</>}
                  </p>
                </div>
                <DataRequestActions id={r.id} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="History">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="py-2">Candidate</th>
              <th>Requested</th>
              <th>Status</th>
              <th>Resolved</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows
              .filter((x) => x.r.status !== "pending")
              .map(({ r, by }) => (
                <tr key={r.id}>
                  <td className="py-1.5">{r.candidateEmail}</td>
                  <td>{r.createdAt.toLocaleDateString()}</td>
                  <td>
                    <Badge tone={TONE[r.status]}>{r.status}</Badge>
                  </td>
                  <td>
                    {r.resolvedAt?.toLocaleDateString()} {by ? `· ${by}` : r.status === "completed" ? "· automatic" : ""}
                  </td>
                  <td className="text-slate-600">{r.resolution}</td>
                </tr>
              ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-500">The candidate&apos;s email and these dates are kept as proof the request was handled; everything else about them is deleted.</p>
      </Card>
    </div>
  );
}
