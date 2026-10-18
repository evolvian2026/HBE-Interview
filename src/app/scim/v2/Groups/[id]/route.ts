import { ScimError } from "@/lib/core/scim";
import { body, scim, scimJson } from "@/lib/scim/http";
import { getGroup, patchGroup, replaceGroup } from "@/lib/services/scim";

type P = { params: Promise<{ id: string }> };

export const GET = scim(async (ctx, _req, { params }: P) => scimJson(await getGroup(ctx, (await params).id)));
export const PATCH = scim(async (ctx, req, { params }: P) => scimJson(await patchGroup(ctx, (await params).id, await body(req))));
export const PUT = scim(async (ctx, req, { params }: P) => scimJson(await replaceGroup(ctx, (await params).id, await body(req))));
export const DELETE = scim(async () => {
  throw new ScimError(403, "Role groups can't be deleted", "mutability");
});
