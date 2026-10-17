import { z } from "zod";
import { requirePlatformAdmin, requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { createOrg } from "@/lib/services/platform";

const Body = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().max(40).optional(),
  admin: z.object({ name: z.string().trim().min(1).max(120), email: z.string().trim().email(), password: z.string().min(1).max(200) }),
});

/** Create an organisation with its first admin (platform admins only). */
export const POST = handle(async (req: Request) => {
  const user = await requireStaff("viewer");
  requirePlatformAdmin(user);
  const org = await createOrg(Body.parse(await req.json()), user);
  return json({ id: org.id, slug: org.slug }, 201);
});
