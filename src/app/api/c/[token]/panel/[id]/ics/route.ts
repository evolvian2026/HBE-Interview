import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { HttpError } from "@/lib/auth/staff";
import { requireCandidacy } from "@/lib/auth/candidate";
import { handle } from "@/lib/http";
import { getSettings } from "@/lib/settings";
import { interviewIcs } from "@/lib/services/panel";

/** Calendar file for the candidate's booked panel interview. */
export const GET = handle(async (_req: Request, { params }: { params: Promise<{ token: string; id: string }> }) => {
  const { token, id } = await params;
  const { candidacy, candidate } = await requireCandidacy(token);
  const [iv] = /^[0-9a-f-]{36}$/i.test(id) ? await db.select().from(schema.panelInterviews).where(eq(schema.panelInterviews.id, id)) : [];
  if (!iv || iv.candidacyId !== candidacy.id) throw new HttpError(404, "Interview not found");
  const [drive] = await db.select({ title: schema.drives.title }).from(schema.drives).where(eq(schema.drives.id, candidacy.driveId));
  const s = await getSettings(candidacy.orgId);
  const ics = interviewIcs(iv, { candidateName: candidate.name, driveTitle: drive.title, companyName: s.companyName }, "candidate");
  if (!ics) throw new HttpError(409, "Choose a time first.");
  return new Response(ics, { headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="interview.ics"`, "cache-control": "no-store" } });
});
