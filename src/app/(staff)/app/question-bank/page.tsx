import { requireStaffPage } from "@/lib/auth/staff";
import { APTITUDE_BANK, SECTION_LABEL } from "@/lib/content/aptitude";
import { SECTIONS } from "@/lib/core/screening";
import { listOwnQuestions } from "@/lib/services/screening";
import { Badge, Card, PageHeader } from "@/components/ui";
import { AddQuestionForm, ImportQuestions, QuestionToggle } from "@/components/staff/screening";

export const dynamic = "force-dynamic";

export default async function QuestionBankPage() {
  const user = await requireStaffPage("recruiter");
  const own = await listOwnQuestions(user.orgId);
  return (
    <>
      <PageHeader title="Question bank" subtitle="Questions for screening tests. Each candidate gets a random set per section with the options shuffled. The built-in questions are always available; add your own to make papers harder to share." />
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        {SECTIONS.map((s) => (
          <div key={s} className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
            <p className="text-xs text-slate-600">{SECTION_LABEL[s]}</p>
            <p className="mt-1 text-2xl font-semibold">{APTITUDE_BANK.filter((q) => q.section === s).length + own.filter((q) => q.active && q.section === s).length}</p>
            <p className="text-xs text-slate-600">{`${APTITUDE_BANK.filter((q) => q.section === s).length} built-in + ${own.filter((q) => q.active && q.section === s).length} yours`}</p>
          </div>
        ))}
      </div>
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card title="Add a question">
          <AddQuestionForm />
        </Card>
        <Card title="Import from a spreadsheet">
          <ImportQuestions />
        </Card>
      </div>
      <Card title={`Your questions (${own.length})`}>
        {own.length === 0 ? (
          <p className="text-sm text-slate-600">None yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {own.map((q) => (
              <li key={q.id} className="py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <Badge>{SECTION_LABEL[q.section]}</Badge> <span className="ml-1">{q.stem}</span>
                    {!q.active && <Badge tone="amber" className="ml-2">retired</Badge>}
                  </span>
                  <QuestionToggle id={q.id} active={q.active} />
                </div>
                <p className="mt-1 text-xs text-slate-600">{(q.options as string[]).map((o, i) => `${"ABCD"[i]}. ${o}${i === q.answer ? " ✓" : ""}`).join("   ")}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
