import Link from "next/link";
import { requireStaffPage } from "@/lib/auth/staff";
import { Logo } from "@/components/ui";
import { LogoutButton } from "@/components/staff/logout-button";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStaffPage();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
          <Link href="/app">
            <Logo />
          </Link>
          <nav className="flex gap-1 text-sm">
            <Link href="/app" className="rounded-md px-3 py-1.5 text-slate-700 hover:bg-slate-100">Hiring drives</Link>
            <Link href="/app/gate-queue" className="rounded-md px-3 py-1.5 text-slate-700 hover:bg-slate-100">Decisions</Link>
            {user.role === "admin" && <Link href="/app/usage" className="rounded-md px-3 py-1.5 text-slate-700 hover:bg-slate-100">AI usage</Link>}
            {user.role === "admin" && <Link href="/app/settings" className="rounded-md px-3 py-1.5 text-slate-700 hover:bg-slate-100">Settings</Link>}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-slate-600">
            <span className="hidden sm:inline">{user.name} · {user.role.replace("_", " ")}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
    </div>
  );
}
