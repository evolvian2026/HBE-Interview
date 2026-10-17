import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { saveSsoConfig } from "@/lib/services/sso";

const Body = z.object({
  issuer: z.string().trim().url().max(500),
  clientId: z.string().trim().min(1).max(300),
  clientSecret: z.string().min(1).max(2000).optional(),
  enabled: z.boolean(),
  required: z.boolean(),
  jitRole: z.enum(["recruiter", "hiring_manager", "viewer"]).nullable(),
});

/** Save the organisation's OpenID Connect settings (the client secret is write-only and stored encrypted). */
export const PUT = handle(async (req: Request) => {
  const user = await requireStaff("admin");
  await saveSsoConfig(user.orgId, Body.parse(await req.json()), user);
  return json({ ok: true });
});
