import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { audit } from "@/lib/audit";
import { API_SCOPES, createApiKey } from "@/lib/services/integrations";

const Body = z.object({ name: z.string().trim().min(1).max(80), scopes: z.array(z.enum(API_SCOPES)).min(1) });

/** Create an API key — the plaintext key is returned once and never stored. */
export const POST = handle(async (req: Request) => {
  const user = await requireStaff("admin");
  const { name, scopes } = Body.parse(await req.json());
  const out = await createApiKey(user.orgId, name, [...new Set(scopes)], user.id);
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "api_key.create", "api_key", out.id, { name, scopes });
  return json(out, 201);
});
