import { body, scim, scimJson } from "@/lib/scim/http";
import { deleteUser, getUser, patchUser, replaceUser } from "@/lib/services/scim";

type P = { params: Promise<{ id: string }> };

export const GET = scim(async (ctx, _req, { params }: P) => scimJson(await getUser(ctx, (await params).id)));
export const PUT = scim(async (ctx, req, { params }: P) => scimJson(await replaceUser(ctx, (await params).id, await body(req))));
export const PATCH = scim(async (ctx, req, { params }: P) => scimJson(await patchUser(ctx, (await params).id, await body(req))));
export const DELETE = scim(async (ctx, _req, { params }: P) => {
  await deleteUser(ctx, (await params).id);
  return new Response(null, { status: 204 });
});
