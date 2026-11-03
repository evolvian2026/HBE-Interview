import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { setQuestionActive } from "@/lib/services/screening";

/** Retire a question from future tests (past attempts keep their copy) or bring it back. */
export const PATCH = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("recruiter");
  await setQuestionActive(user, (await params).id, z.object({ active: z.boolean() }).parse(await req.json()).active);
  return json({ ok: true });
});
