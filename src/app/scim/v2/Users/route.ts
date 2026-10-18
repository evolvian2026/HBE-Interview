import { body, scim, scimJson } from "@/lib/scim/http";
import { createUser, listUsers } from "@/lib/services/scim";

export const GET = scim(async (ctx, req) => scimJson(await listUsers(ctx, new URL(req.url).searchParams)));
export const POST = scim(async (ctx, req) => scimJson(await createUser(ctx, await body(req)), 201));
