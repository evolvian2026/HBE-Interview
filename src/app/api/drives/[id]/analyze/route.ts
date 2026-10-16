import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { reanalyzeDrive } from "@/lib/services/drives";

export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("recruiter");
  const { id } = await params;
  return json({ config: await reanalyzeDrive(id, user) });
});
