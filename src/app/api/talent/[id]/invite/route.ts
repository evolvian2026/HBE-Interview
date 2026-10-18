import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { reinvite } from "@/lib/services/talent";

const Body = z.object({ driveId: z.string() });

/** Invite a talent-pool candidate to another drive, reusing their resume. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("recruiter");
  const { id } = await params;
  return json(await reinvite(user, id, Body.parse(await req.json()).driveId), 201);
});
