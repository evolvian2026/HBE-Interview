import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { createCustomProblem } from "@/lib/services/problems";
import { audit } from "@/lib/audit";

const Test = z.object({ input: z.string().max(50_000), output: z.string().max(50_000) });
const Body = z.object({
  title: z.string().trim().min(3).max(120),
  difficulty: z.enum(["easy", "medium", "hard"]),
  statement: z.string().trim().min(30).max(10_000),
  samples: z.array(Test).min(1).max(5),
  hidden: z.array(Test).min(3).max(30),
  referenceLanguage: z.enum(["python", "javascript", "java", "cpp"]),
  referenceCode: z.string().min(10).max(64_000),
});

/** Create a custom coding problem for this drive; it becomes eligible only if the reference solution passes every test. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("recruiter");
  const { id } = await params;
  const input = Body.parse(await req.json());
  const { problem, validation } = await createCustomProblem(id, input, user.id);
  await audit({ type: "staff", id: user.id }, "problem.create", "drive", id, { problemId: problem.id, valid: validation.ok });
  return json({ id: problem.id, validation });
});
