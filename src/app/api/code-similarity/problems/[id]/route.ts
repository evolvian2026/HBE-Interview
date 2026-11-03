import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { setProblemRetired } from "@/lib/services/similarity";

const Body = z.object({ retired: z.boolean() });

/** Retire a coding problem from new interviews (or restore it). */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("admin");
  await setProblemRetired(user, decodeURIComponent((await params).id), Body.parse(await req.json()).retired);
  return json({ ok: true });
});
