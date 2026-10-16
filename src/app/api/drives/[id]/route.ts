import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { saveDraft } from "@/lib/services/drives";

export const PUT = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("recruiter");
  const { id } = await params;
  const body = await req.json();
  return json(await saveDraft(id, body.config, user));
});
