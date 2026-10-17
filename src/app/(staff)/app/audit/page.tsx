import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireStaffPage } from "@/lib/auth/staff";
import { AUDIT_CATEGORIES, queryAudit } from "@/lib/services/audit-log";
import { Badge, Card, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const RANGES = [
  { v: "1", label: "24 hours" },
  { v: "7", label: "7 days" },
  { v: "30", label: "30 days" },
  { v: "90", label: "90 days" },
  { v: "all", label: "All time" },
];
const TONE: Record<string, "red" | "amber" | "green" | "blue" | "slate"> = { auth: "blue", org: "amber", user: "amber", data: "red", settings: "amber", api_key: "amber", webhook: "amber" };
const PAGE = 100;

function summary(data: unknown): string {
  if (data == null) return "";
  const s = JSON.stringify(data);
  return s.length > 140 ? `${s.slice(0, 140)}…` : s;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ category?: string; actor?: string; days?: string; q?: string; page?: string }> }) {
  const user = await requireStaffPage("admin");
  const sp = await searchParams;
  const daysParam = sp.days ?? "30";
  const page = Math.max(0, Number(sp.page ?? 0) || 0);
  const filter = { category: sp.category || undefined, actorId: sp.actor || undefined, days: daysParam === "all" ? null : Number(daysParam) || 30, q: sp.q || undefined };
  const { rows, more } = await queryAudit(user.orgId, filter, PAGE, page * PAGE);
  const staff = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(eq(schema.users.orgId, user.orgId)).orderBy(asc(schema.users.name));
  const qs = (extra: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ category: sp.category, actor: sp.actor, days: daysParam, q: sp.q, ...extra })) if (v !== undefined && v !== "") p.set(k, String(v));
    return p.toString();
  };
  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        subtitle="Every sign-in, configuration change, report view, export, decision and data request in your organisation."
        actions={
          <a className="rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50" href={`/api/audit/export?${qs({ page: undefined })}`}>
            Export CSV
          </a>
        }
      />
      <Card>
        <form className="flex flex-wrap items-end gap-3 text-sm" method="get">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Category</span>
            <select name="category" defaultValue={sp.category ?? ""} className="rounded-lg border border-slate-300 px-2 py-1.5">
              <option value="">All</option>
              {AUDIT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.replace("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Staff member</span>
            <select name="actor" defaultValue={sp.actor ?? ""} className="rounded-lg border border-slate-300 px-2 py-1.5">
              <option value="">Anyone</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Period</span>
            <select name="days" defaultValue={daysParam} className="rounded-lg border border-slate-300 px-2 py-1.5">
              {RANGES.map((r) => (
                <option key={r.v} value={r.v}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block grow">
            <span className="mb-1 block text-xs font-medium text-slate-600">Search (entity id, action or details)</span>
            <input name="q" defaultValue={sp.q ?? ""} className="w-full rounded-lg border border-slate-300 px-2 py-1.5" />
          </label>
          <button type="submit" className="rounded-lg bg-brand-600 px-3.5 py-2 font-medium text-white hover:bg-brand-700">
            Filter
          </button>
        </form>
      </Card>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Audit events</caption>
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2">When</th>
                <th>Who</th>
                <th>Action</th>
                <th>On</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 align-top">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-slate-500">
                    No events match these filters.
                  </td>
                </tr>
              )}
              {rows.map(({ a, actorName }) => {
                const cat = a.action.split(".")[0];
                return (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap py-1.5 tabular-nums text-slate-600">{a.createdAt.toLocaleString()}</td>
                    <td className="whitespace-nowrap">{actorName ?? <span className="text-slate-500">{a.actorType}</span>}</td>
                    <td>
                      <Badge tone={TONE[cat] ?? "slate"}>{a.action}</Badge>
                    </td>
                    <td className="whitespace-nowrap">
                      {a.entity === "candidacy" && a.entityId ? (
                        <Link href={`/app/candidates/${a.entityId}`} className="text-brand-700 hover:underline">
                          candidate {a.entityId.slice(0, 8)}
                        </Link>
                      ) : a.entity === "drive" && a.entityId ? (
                        <Link href={`/app/drives/${a.entityId}`} className="text-brand-700 hover:underline">
                          drive {a.entityId.slice(0, 8)}
                        </Link>
                      ) : (
                        <span className="text-slate-600">
                          {a.entity}
                          {a.entityId ? ` ${a.entityId.slice(0, 8)}` : ""}
                        </span>
                      )}
                    </td>
                    <td className="max-w-md break-all font-mono text-xs text-slate-500">{summary(a.data)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex justify-between text-sm">
          {page > 0 ? (
            <Link href={`/app/audit?${qs({ page: page - 1 })}`} className="text-brand-700 hover:underline">
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          {more && (
            <Link href={`/app/audit?${qs({ page: page + 1 })}`} className="text-brand-700 hover:underline">
              Older →
            </Link>
          )}
        </div>
      </Card>
    </div>
  );
}
