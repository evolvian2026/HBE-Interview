import { requirePlatformAdmin, requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { confirmDomainByPlatform } from "@/lib/services/sso";

/** Platform admins confirm domain ownership established outside DNS (e.g. contract, support ticket). */
export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("viewer");
  requirePlatformAdmin(user);
  await confirmDomainByPlatform((await params).id, user);
  return json({ ok: true });
});
