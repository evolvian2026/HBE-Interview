import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { submitScorecard } from "@/lib/services/panel";

const Body = z.object({
  ratings: z.record(z.string(), z.number().int().min(1).max(5).nullable()),
  recommendation: z.enum(["strong_hire", "hire", "lean_no", "no_hire"]),
  strengths: z.string().max(4000).optional(),
  concerns: z.string().max(4000).optional(),
});

/** A panelist submits (or, until the final decision, updates) their scorecard. */
export const PUT = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("hiring_manager");
  const { id } = await params;
  await submitScorecard(user, id, Body.parse(await req.json()));
  return json({ ok: true });
});
