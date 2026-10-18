import Link from "next/link";
import { requireStaffPage } from "@/lib/auth/staff";
import { myInterviews } from "@/lib/services/panel";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { LocalTime } from "@/components/local-time";

export const dynamic = "force-dynamic";

export default async function MyInterviewsPage() {
  const user = await requireStaffPage("hiring_manager");
  const rows = await myInterviews(user);
  const now = Date.now();
  const upcoming = rows.filter((r) => !r.iv.scheduledAt || r.iv.scheduledAt.getTime() + r.iv.durationMin * 60_000 > now);
  const past = rows.filter((r) => !upcoming.includes(r));
  const List = ({ items }: { items: typeof rows }) => (
    <ul className="divide-y divide-slate-100 text-sm">
      {items.map(({ iv, card, name, driveTitle }) => (
        <li key={iv.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <span>
            <b>{name}</b> · {driveTitle} · {iv.title} · {iv.scheduledAt ? <LocalTime iso={iv.scheduledAt.toISOString()} /> : <span className="text-slate-500">time not booked yet</span>}{" "}
            {card.submittedAt ? <Badge tone="green">scorecard submitted</Badge> : iv.scheduledAt && iv.scheduledAt.getTime() < now ? <Badge tone="amber">scorecard due</Badge> : null}
          </span>
          <Link href={`/app/panel/${iv.id}`} className="font-medium text-brand-600 hover:underline">
            Interview kit →
          </Link>
        </li>
      ))}
    </ul>
  );
  return (
    <>
      <PageHeader title="My interviews" subtitle="Panel interviews you're on. Open the kit to prepare, then submit your scorecard before reading the rest of the panel's feedback." />
      {rows.length === 0 ? (
        <Empty>You aren&apos;t on any panel interviews.</Empty>
      ) : (
        <div className="space-y-6">
          <Card title={`Upcoming (${upcoming.length})`}>{upcoming.length ? <List items={upcoming} /> : <p className="text-sm text-slate-500">None.</p>}</Card>
          <Card title={`Past (${past.length})`}>{past.length ? <List items={past} /> : <p className="text-sm text-slate-500">None.</p>}</Card>
        </div>
      )}
    </>
  );
}
