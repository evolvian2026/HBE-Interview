import { HttpError } from "../auth/staff";
import { ScimError, scimError } from "../core/scim";
import { limit } from "../security/rate-limit";
import { scimAuth, type ScimCtx } from "../services/scim";

const TYPE = "application/scim+json";

export function scimJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": TYPE, "cache-control": "no-store" } });
}

/** Wrap a SCIM handler: bearer auth, per-organisation rate limit, SCIM-shaped errors. */
export function scim<A extends unknown[]>(fn: (ctx: ScimCtx, req: Request, ...args: A) => Promise<Response>) {
  return async (req: Request, ...args: A): Promise<Response> => {
    try {
      const ctx = await scimAuth(req);
      await limit(`scim:${ctx.orgId}`, 1200, 60, "Too many SCIM requests");
      return await fn(ctx, req, ...args);
    } catch (e) {
      if (e instanceof ScimError) return scimJson(scimError(e.status, e.message, e.scimType), e.status);
      if (e instanceof HttpError) return scimJson(scimError(e.status, e.message), e.status);
      if (e instanceof SyntaxError) return scimJson(scimError(400, "Body must be JSON", "invalidSyntax"), 400);
      console.error("[scim]", e);
      return scimJson(scimError(500, "Something went wrong"), 500);
    }
  };
}

export async function body(req: Request): Promise<Record<string, unknown>> {
  const b = await req.json();
  if (!b || typeof b !== "object" || Array.isArray(b)) throw new ScimError(400, "Body must be a JSON object", "invalidSyntax");
  return b as Record<string, unknown>;
}
