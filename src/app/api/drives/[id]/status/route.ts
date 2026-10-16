import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { setDriveStatus } from "@/lib/services/drives";

const Body = z.object({ status: z.enum(["active", "paused", "closed"]) });

export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("recruiter");
  const { id } = await params;
  await setDriveStatus(id, Body.parse(await req.json()).status, user);
  return json({ ok: true });
});
