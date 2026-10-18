import Link from "next/link";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireStaffPage } from "@/lib/auth/staff";
import { actionCount, inbox } from "@/lib/services/inbox";
import { Badge, Card, PageHeader } from "@/components/ui";
import { LocalTime } from "@/components/local-time";
import { DigestToggle } from "@/components/staff/digest-toggle";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const user = await requireStaffPage();
  const sections = await inbox(user);
  const [me] = await db.select({ digest: schema.users.digestOptIn }).from(schema.users).where(eq(schema.users.id, user.id));
  const total = actionCount(sections);
  const withItems = sections.filter((s) => s.count > 0);
  const quiet = sections.filter((s) => s.count === 0);
  return (
    <>
      <PageHeader
        title="Inbox"
        subtitle={total ? `${total} thing${total === 1 ? "" : "s"} waiting for you.` : "You're all caught up."}
        actions={<DigestToggle initial={!!me?.digest} />}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        {withItems.map((s) => (
          <Card
            key={s.key}
            title={
              <span className="flex items-center gap-2">
                {s.title} <Badge tone={s.kind === "action" ? "amber" : "slate"}>{s.count}</Badge>
              </span>
            }
          >
            <ul className="divide-y divide-slate-100 text-sm">
              {s.items.map((i, k) => (
                <li key={k} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <Link href={i.href} className="font-medium text-brand-700 hover:underline">
                      {i.label}
                    </Link>
                    {i.sub && <span className="block text-xs text-slate-600">{i.sub}</span>}
                  </span>
                  {i.at && (
                    <span className="text-xs text-slate-500">
                      <LocalTime iso={i.at} withZone={false} />
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {s.count > s.items.length && (
              <p className="mt-2 text-xs text-slate-600">
                {`and ${s.count - s.items.length} more · `}
                {s.more && (
                  <Link href={s.more.href} className="text-brand-700 underline">
                    {s.more.label}
                  </Link>
                )}
              </p>
            )}
          </Card>
        ))}
      </div>
      {quiet.length > 0 && (
        <p className="mt-6 text-sm text-slate-500">{`Nothing waiting in: ${quiet.map((s) => s.title.toLowerCase()).join(" · ")}.`}</p>
      )}
    </>
  );
}
