import { z } from "zod";
import { createStaffSession, HttpError, isUuid, requirePlatformAdmin, requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { getOrg } from "@/lib/tenancy";
import { audit } from "@/lib/audit";

const Body = z.object({ orgId: z.string() });

/** Platform admins act inside another organisation (as its admin) until they switch back. */
export const POST = handle(async (req: Request) => {
  const user = await requireStaff("viewer");
  requirePlatformAdmin(user);
  const { orgId } = Body.parse(await req.json());
  const org = isUuid(orgId) ? await getOrg(orgId) : null;
  if (!org) throw new HttpError(404, "Organisation not found");
  await createStaffSession(user, org.id === user.homeOrgId ? undefined : org.id, { sso: user.viaSso });
  await audit({ type: "staff", id: user.id, orgId: org.id }, "org.switch", "organization", org.id);
  return json({ ok: true });
});
