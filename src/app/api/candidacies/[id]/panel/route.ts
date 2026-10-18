import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { scheduleInterview } from "@/lib/services/panel";

const Body = z.object({
  title: z.string().trim().min(3).max(120),
  durationMin: z.number().int().min(15).max(240),
  location: z.string().trim().min(3).max(500),
  slots: z.array(z.string().max(40)).min(1).max(5),
  panelistIds: z.array(z.string()).min(1).max(8),
  competencies: z.array(z.string().max(60)).min(1).max(8),
});

/** Arrange a live panel interview: one time books it, several let the candidate choose. Recruiters and admins. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("recruiter");
  const { id } = await params;
  const iv = await scheduleInterview(user, id, Body.parse(await req.json()));
  return json({ id: iv.id, status: iv.status }, 201);
});
