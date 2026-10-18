import { ScimError } from "@/lib/core/scim";
import { scim, scimJson } from "@/lib/scim/http";
import { listGroups } from "@/lib/services/scim";

export const GET = scim(async (ctx, req) => scimJson(await listGroups(ctx, new URL(req.url).searchParams)));
/** The four role groups are fixed: assign people to them instead of creating new ones. */
export const POST = scim(async () => {
  throw new ScimError(403, "Groups are fixed (HBE Admins, HBE Recruiters, HBE Hiring Managers, HBE Viewers); assign members to them instead", "mutability");
});
