import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { addQuestion } from "@/lib/services/screening";

const Body = z.object({
  section: z.string().max(20),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  stem: z.string().max(2000),
  options: z.array(z.string().max(500)).length(4),
  answer: z.number().int().min(0).max(3),
  explanation: z.string().max(2000).optional(),
});

/** Add one of the organisation's own screening questions. */
export const POST = handle(async (req: Request) => {
  const user = await requireStaff("recruiter");
  const q = await addQuestion(user, Body.parse(await req.json()));
  return json({ id: q.id }, 201);
});
