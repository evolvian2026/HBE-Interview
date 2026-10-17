import { z } from "zod";
import { candidacyByToken } from "@/lib/auth/candidate";
import { HttpError } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { requestDeletion } from "@/lib/services/data-rights";

const Body = z.object({ reason: z.string().trim().max(1000).optional() });

/** Right to erasure: the candidate asks the organisation to delete their data (fulfilled within 30 days). */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ token: string }> }) => {
  const { token } = await params;
  const row = await candidacyByToken(token); // data rights apply even after an invitation expired
  if (!row) throw new HttpError(404, "This link is not valid");
  const { candidacy, candidate } = row;
  const { reason } = Body.parse(await req.json().catch(() => ({})));
  const r = await requestDeletion(candidacy, candidate.email, reason || null);
  return json({ id: r.id, dueAt: r.dueAt.toISOString() }, 201);
});
