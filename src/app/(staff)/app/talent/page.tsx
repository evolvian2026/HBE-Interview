import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { canSeeDrive, requireStaffPage } from "@/lib/auth/staff";
import { orgTags, searchTalent } from "@/lib/services/talent";
import { RECOMMENDATION_LABEL, type Recommendation } from "@/lib/core/types";
import { Badge, Card, Empty, Input, PageHeader, Select } from "@/components/ui";
import { REC_TONE, STAGE_LABEL, STAGE_TONE } from "@/components/labels";

export const dynamic = "force-dynamic";

export default async function TalentPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaffPage("recruiter");
  const sp = await searchParams;
  const rec = (["strong_hire", "hire", "lean_no", "no_hire"] as const).find((r) => r === sp.rec);
  const minScore = sp.min && Number.isFinite(Number(sp.min)) ? Number(sp.min) : undefined;
  const results = await searchTalent(user, { q: sp.q, driveId: sp.drive, stage: sp.stage || undefined, recommendation: rec, minScore, tag: sp.tag || undefined, poolOnly: sp.pool === "1" });
  const drives = (await db.select().from(schema.drives).where(and(eq(schema.drives.orgId, user.orgId)))).filter((d) => canSeeDrive(user, d));
  const tags = await orgTags(user.orgId);
  return (
    <>
      <PageHeader title="Talent pool" subtitle="Search everyone who has applied to your organisation, across hiring drives. People who opted in to be considered for future roles can be invited to another drive without uploading their resume again." />
      <Card className="mb-6">
        <form className="grid gap-3 text-sm md:grid-cols-4 lg:grid-cols-7" role="search" aria-label="Search candidates">
          <label className="block md:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-700">Name, email or skill</span>
            <Input name="q" defaultValue={sp.q ?? ""} placeholder="e.g. Kafka, Priya, @acme.com" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">Drive</span>
            <Select name="drive" defaultValue={sp.drive ?? ""}>
              <option value="">Any</option>
              {drives.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">Stage</span>
            <Select name="stage" defaultValue={sp.stage ?? ""}>
              <option value="">Any</option>
              {Object.entries(STAGE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">AI recommendation</span>
            <Select name="rec" defaultValue={sp.rec ?? ""}>
              <option value="">Any</option>
              {Object.entries(RECOMMENDATION_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">Tag</span>
            <Select name="tag" defaultValue={sp.tag ?? ""}>
              <option value="">Any</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </label>
          <div className="flex flex-col justify-end gap-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="pool" value="1" defaultChecked={sp.pool === "1"} /> Talent pool only
            </label>
            <button type="submit" className="rounded-lg bg-brand-600 px-3.5 py-2 font-medium text-white hover:bg-brand-700">
              Search
            </button>
          </div>
        </form>
      </Card>
      {results.length === 0 ? (
        <Empty>No candidates match.</Empty>
      ) : (
        <Card title={`${results.length} ${results.length === 1 ? "person" : "people"}${results.length === 100 ? " (first 100)" : ""}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Candidate</th>
                  <th className="py-2 pr-3">Latest application</th>
                  <th className="py-2 pr-3">Stage</th>
                  <th className="py-2 pr-3">AI</th>
                  <th className="py-2">Tags</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {results.map((r) => (
                  <tr key={r.cand.id}>
                    <td className="py-2 pr-3">
                      <Link href={`/app/talent/${r.cand.id}`} className="font-medium text-brand-700 hover:underline">
                        {r.cand.name}
                      </Link>
                      <span className="block text-xs text-slate-500">{r.cand.email}</span>
                      {r.inPool && <Badge tone="green">talent pool</Badge>}
                    </td>
                    <td className="py-2 pr-3">
                      {r.d.title}
                      <span className="block text-xs text-slate-500">{`${r.c.createdAt.toLocaleDateString()}${r.applications > 1 ? ` · ${r.applications} applications` : ""}`}</span>
                    </td>
                    <td className="py-2 pr-3">
                      <Badge tone={STAGE_TONE[r.c.stage] ?? "slate"}>{STAGE_LABEL[r.c.stage] ?? r.c.stage}</Badge>
                    </td>
                    <td className="py-2 pr-3">{r.rec ? <Badge tone={REC_TONE[r.rec as Recommendation]}>{`${RECOMMENDATION_LABEL[r.rec as Recommendation]} · ${r.score?.toFixed(0) ?? "—"}`}</Badge> : <span className="text-slate-400">—</span>}</td>
                    <td className="py-2 text-xs text-slate-600">{r.cand.tags.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
