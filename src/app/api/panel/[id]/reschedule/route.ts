import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { rescheduleInterview } from "@/lib/services/panel";

const Body = z.object({ slots: z.array(z.string().max(40)).min(1).max(5) });

export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("recruiter");
  const { id } = await params;
  const iv = await rescheduleInterview(user, id, Body.parse(await req.json()).slots);
  return json({ status: iv.status });
});
