import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { importQuestions } from "@/lib/services/screening";

/** Import questions from CSV (section, difficulty, question, a, b, c, d, answer, explanation). */
export const POST = handle(async (req: Request) => {
  const user = await requireStaff("recruiter");
  return json(await importQuestions(user, z.object({ csv: z.string().max(2_000_000) }).parse(await req.json()).csv));
});
