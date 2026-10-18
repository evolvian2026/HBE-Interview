import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { issueScimToken, updateScimConfig } from "@/lib/services/scim";

const Role = z.enum(["recruiter", "hiring_manager", "viewer"]);

/** Create or rotate the SCIM token (shown once). Admins. */
export const POST = handle(async (req: Request) => {
  const user = await requireStaff("admin");
  const { defaultRole } = z.object({ defaultRole: Role.default("viewer") }).parse(await req.json().catch(() => ({})));
  return json({ token: await issueScimToken(user, defaultRole) }, 201);
});

export const PATCH = handle(async (req: Request) => {
  const user = await requireStaff("admin");
  await updateScimConfig(user, z.object({ enabled: z.boolean().optional(), defaultRole: Role.optional() }).parse(await req.json()));
  return json({ ok: true });
});
