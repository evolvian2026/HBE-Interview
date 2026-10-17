import { z } from "zod";
import { assertCandidacyAccess, requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { decideAccommodation } from "@/lib/services/accommodations";
import { EXTRA_TIME_OPTIONS } from "@/lib/core/calibration";

const Body = z.object({
  approve: z.boolean(),
  extraTimePct: z.number().int().refine((n) => (EXTRA_TIME_OPTIONS as readonly number[]).includes(n)).optional(),
  extraBreaks: z.boolean().optional(),
  note: z.string().max(1000).optional(),
});

/** Approve (optionally adjusting) or decline a candidate's adjustment request. Recruiters and admins only. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("recruiter");
  const { id } = await params;
  await assertCandidacyAccess(user, id);
  await decideAccommodation(user, id, Body.parse(await req.json()));
  return json({ ok: true });
});
