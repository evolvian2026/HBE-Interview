import { candidacyByToken } from "@/lib/auth/candidate";
import { HttpError } from "@/lib/auth/staff";
import { handle } from "@/lib/http";
import { audit } from "@/lib/audit";
import { exportCandidateData } from "@/lib/services/data-rights";
import { limit } from "@/lib/security/rate-limit";

/** Right of access: the candidate downloads their data as JSON. */
export const GET = handle(async (_req: Request, { params }: { params: Promise<{ token: string }> }) => {
  const { token } = await params;
  const row = await candidacyByToken(token); // data rights apply even after an invitation expired
  if (!row) throw new HttpError(404, "This link is not valid");
  const { candidacy } = row;
  await limit(`export:${candidacy.id}`, 5, 3600, "You've downloaded your data several times recently — please try again in an hour.");
  const data = await exportCandidateData(candidacy.id);
  await audit({ type: "candidate", id: candidacy.id, orgId: candidacy.orgId }, "data.export", "candidacy", candidacy.id);
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="my-interview-data.json"`, "cache-control": "no-store" },
  });
});
