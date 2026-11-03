import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { deleteReference } from "@/lib/services/similarity";

export const DELETE = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("admin");
  await deleteReference(user, (await params).id);
  return json({ ok: true });
});
