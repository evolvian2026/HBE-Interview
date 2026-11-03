import { z } from "zod";
import { requireCandidacy } from "@/lib/auth/candidate";
import { handle, json } from "@/lib/http";
import { recordFocusLoss } from "@/lib/services/screening";

/** Times the candidate left the test tab (shown to recruiters as context). */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ token: string }> }) => {
  const { candidacy } = await requireCandidacy((await params).token);
  await recordFocusLoss(candidacy, z.object({ count: z.number().int().min(0).max(20) }).parse(await req.json()).count);
  return json({ ok: true });
});
