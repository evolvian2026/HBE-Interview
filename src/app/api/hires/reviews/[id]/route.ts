import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { submitReview } from "@/lib/services/hires";

const score = z.number().int().min(1).max(5);
const Body = z.object({
  rating: score,
  technical: score.nullable().optional(),
  collaboration: score.nullable().optional(),
  values: score.nullable().optional(),
  wouldRehire: z.enum(["yes", "no", "unsure"]),
  note: z.string().max(3000).optional(),
});

/** The manager's 90- or 180-day rating of a hire. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("hiring_manager");
  await submitReview(user, (await params).id, Body.parse(await req.json()));
  return json({ ok: true });
});
