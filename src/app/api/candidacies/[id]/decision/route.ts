import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { recordDecision } from "@/lib/services/panel";

const Body = z.object({
  decision: z.enum(["offer", "reject", "hold"]),
  reason: z.string().trim().min(10, "Give the reasoning for the decision (at least 10 characters)").max(4000),
  notifyCandidate: z.boolean().default(false),
});

/** Record the final hiring decision with its reasoning (hiring managers and above). */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("hiring_manager");
  const { id } = await params;
  const d = await recordDecision(user, id, Body.parse(await req.json()));
  return json({ id: d.id }, 201);
});
