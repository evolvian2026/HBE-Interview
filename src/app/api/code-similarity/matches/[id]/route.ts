import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { reviewMatch } from "@/lib/services/similarity";

const Body = z.object({ status: z.enum(["open", "coincidence", "copied"]), note: z.string().max(2000).optional() });

/** A recruiter's conclusion on a code match. It never changes scores — it's recorded for the hiring decision. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("recruiter");
  await reviewMatch(user, (await params).id, Body.parse(await req.json()));
  return json({ ok: true });
});
