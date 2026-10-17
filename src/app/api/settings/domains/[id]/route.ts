import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { removeDomain } from "@/lib/services/sso";

export const DELETE = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("admin");
  await removeDomain(user.orgId, (await params).id, user);
  return json({ ok: true });
});
