import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { reviewAttempt } from "@/lib/services/screening";

const Body = z.object({ decision: z.enum(["pass", "fail"]), note: z.string().max(1000).optional() });

/** Decide on a screening test held for review (below the pass mark on a "review" drive). */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("recruiter");
  const b = Body.parse(await req.json());
  await reviewAttempt(user, (await params).id, b.decision, b.note);
  return json({ ok: true });
});
