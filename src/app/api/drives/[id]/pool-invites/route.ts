import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { bulkReinvite } from "@/lib/services/matching";

const Body = z.object({ candidateIds: z.array(z.string()).min(1).max(25) });

/** Invite several talent-pool candidates to this drive at once (recruiters and admins). */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("recruiter");
  const { id } = await params;
  return json({ results: await bulkReinvite(user, id, Body.parse(await req.json()).candidateIds) });
});
