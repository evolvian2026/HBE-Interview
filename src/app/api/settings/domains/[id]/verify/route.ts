import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { verifyDomainDns } from "@/lib/services/sso";
import { limit } from "@/lib/security/rate-limit";

/** Check the domain's DNS TXT record. */
export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("admin");
  await limit(`domain-verify:${user.orgId}`, 30, 3600);
  const d = await verifyDomainDns(user.orgId, (await params).id, user);
  return json({ verified: !!d.verifiedAt });
});
