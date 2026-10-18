import Link from "next/link";
import { requireStaffPage } from "@/lib/auth/staff";
import { getOrg } from "@/lib/tenancy";
import { orgBudget } from "@/lib/services/platform";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { Logo } from "@/components/ui";
import { LogoutButton } from "@/components/staff/logout-button";
import { ReturnHomeButton } from "@/components/staff/return-home-button";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStaffPage("viewer", { allowEnrollment: true });
  const org = await getOrg(user.orgId);
  const away = user.orgId !== user.homeOrgId;
  const budget = user.role === "admin" ? await orgBudget(user.orgId) : null;
  const [dr] =
    user.role === "admin"
      ? await db
          .select({ n: sql<number>`count(*)::int`, due: sql<Date | null>`min(${schema.dataRequests.dueAt})` })
          .from(schema.dataRequests)
          .where(and(eq(schema.dataRequests.orgId, user.orgId), eq(schema.dataRequests.status, "pending")))
      : [];
  return (
    <div className="min-h-screen">
      {away && (
        <div className="bg-amber-100 px-4 py-1.5 text-center text-sm text-amber-900">
          You are acting as an administrator of <b>{org?.name}</b> (platform access). Changes affect this organisation. <ReturnHomeButton orgId={user.homeOrgId} />
        </div>
      )}
      {budget?.ratio != null && budget.ratio >= 0.8 && (
        <div className={`px-4 py-1.5 text-center text-sm ${budget.ratio >= 1 ? "bg-red-100 text-red-900" : "bg-amber-50 text-amber-900"}`}>
          AI spend this month is {Math.round(budget.ratio * 100)}% of the ${budget.budget?.toFixed(0)} budget. Interviews continue; see <Link href="/app/usage" className="underline">AI usage</Link>.
        </div>
      )}
      {!!dr?.n && (
        <div className="bg-red-50 px-4 py-1.5 text-center text-sm text-red-900">
          {dr.n} candidate data deletion request{dr.n === 1 ? "" : "s"} waiting{dr.due ? ` (earliest due ${new Date(dr.due).toLocaleDateString()})` : ""}.{" "}
          <Link href="/app/data-requests" className="underline">
            Review
          </Link>
        </div>
      )}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
          <Link href="/app" className="flex items-center gap-2">
            <Logo />
            {org && <span className="hidden rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 md:inline">{org.name}</span>}
          </Link>
          <nav className="flex gap-1 text-sm">
            <Link href="/app" className="rounded-md px-3 py-1.5 text-slate-700 hover:bg-slate-100">Hiring drives</Link>
            <Link href="/app/gate-queue" className="rounded-md px-3 py-1.5 text-slate-700 hover:bg-slate-100">Decisions</Link>
            {user.role !== "viewer" && <Link href="/app/panel" className="rounded-md px-3 py-1.5 text-slate-700 hover:bg-slate-100">My interviews</Link>}
            {user.role !== "viewer" && <Link href="/app/calibration" className="rounded-md px-3 py-1.5 text-slate-700 hover:bg-slate-100">Calibration</Link>}
            {user.role === "admin" && <Link href="/app/usage" className="rounded-md px-3 py-1.5 text-slate-700 hover:bg-slate-100">AI usage</Link>}
            {user.role === "admin" && <Link href="/app/audit" className="rounded-md px-3 py-1.5 text-slate-700 hover:bg-slate-100">Audit</Link>}
            {user.role === "admin" && <Link href="/app/settings" className="rounded-md px-3 py-1.5 text-slate-700 hover:bg-slate-100">Settings</Link>}
            {user.platformAdmin && <Link href="/app/platform" className="rounded-md px-3 py-1.5 text-slate-700 hover:bg-slate-100">Platform</Link>}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-slate-600">
            <Link href="/app/security" className="hidden hover:text-slate-900 sm:inline" title="Security settings">
              {user.name} · {user.role.replace("_", " ")}
            </Link>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
    </div>
  );
}
