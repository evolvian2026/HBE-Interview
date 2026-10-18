import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { cancelInterview } from "@/lib/services/panel";

const Body = z.object({ reason: z.string().trim().min(3).max(1000) });

export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("recruiter");
  const { id } = await params;
  await cancelInterview(user, id, Body.parse(await req.json()).reason);
  return json({ ok: true });
});
