import { requireStaff } from "@/lib/auth/staff";
import { handle } from "@/lib/http";
import { HttpError } from "@/lib/auth/staff";
import { getSettings } from "@/lib/settings";
import { interviewIcs, interviewKit } from "@/lib/services/panel";

/** Calendar file for a panelist (or anyone who can open the kit). */
export const GET = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("hiring_manager");
  const { id } = await params;
  const kit = await interviewKit(user, id);
  const s = await getSettings(user.orgId);
  const ics = interviewIcs(kit.interview, { candidateName: kit.candidate.name, driveTitle: kit.candidate.driveTitle, companyName: s.companyName }, "panel");
  if (!ics) throw new HttpError(409, "This interview hasn't been booked yet.");
  return new Response(ics, { headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="panel-interview.ics"`, "cache-control": "no-store" } });
});
