import Link from "next/link";
import { requireStaffPage } from "@/lib/auth/staff";
import { getOrg } from "@/lib/tenancy";
import { orgBudget } from "@/lib/services/platform";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { Logo } from "@/components/ui";
import { LogoutButton } from "@/components/staff/logout-button";
import { ReturnHomeButton } from "@/components/staff/return-home-button";
import { AdminMenu } from "@/components/staff/admin-menu";
import { actionCount, inbox } from "@/lib/services/inbox";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStaffPage("viewer", { allowEnrollment: true });
  const org = await getOrg(user.orgId);
  const away = user.orgId !== user.homeOrgId;
  const waiting = user.mustEnroll2fa ? 0 : actionCount(await inbox(user, { light: true }));
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
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
          <Link href="/app" className="flex items-center gap-2">
            <Logo />
            {org && <span className="hidden rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 md:inline">{org.name}</span>}
          </Link>
          <nav aria-label="Main" className="flex items-center gap-0.5 text-sm">
            <Link href="/app" className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-slate-700 hover:bg-slate-100">Hiring drives</Link>
            <Link href="/app/inbox" className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-slate-700 hover:bg-slate-100" aria-label={waiting ? `Inbox, ${waiting} waiting` : "Inbox"}>
              Inbox{waiting > 0 && <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900">{waiting}</span>}
            </Link>
            <Link href="/app/gate-queue" className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-slate-700 hover:bg-slate-100">Decisions</Link>
            {user.role !== "viewer" && <Link href="/app/panel" className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-slate-700 hover:bg-slate-100">My interviews</Link>}
            {(user.role === "recruiter" || user.role === "admin") && <Link href="/app/talent" className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-slate-700 hover:bg-slate-100">Talent</Link>}
            {(user.role === "recruiter" || user.role === "admin") && <Link href="/app/insights" className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-slate-700 hover:bg-slate-100">Insights</Link>}
            {user.role !== "viewer" && <Link href="/app/calibration" className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-slate-700 hover:bg-slate-100">Calibration</Link>}
            {(user.role === "admin" || user.platformAdmin) && (
              <AdminMenu
                items={[
                  ...(user.role === "admin"
                    ? [
                        { href: "/app/settings", label: "Settings" },
                        { href: "/app/usage", label: "AI usage" },
                        { href: "/app/audit", label: "Audit log" },
                      ]
                    : []),
                  ...(user.platformAdmin ? [{ href: "/app/platform", label: "Platform" }] : []),
                ]}
              />
            )}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-slate-600">
            <Link href="/app/security" className="hidden whitespace-nowrap hover:text-slate-900 lg:inline" title="Security settings">
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
