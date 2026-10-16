import { z } from "zod";
import { requirePlatformAdmin, requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { updateOrg } from "@/lib/services/platform";

const Body = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  status: z.enum(["active", "suspended"]).optional(),
  aiBudgetUsd: z.number().min(0).max(1_000_000).nullable().optional(),
});

/** Rename, suspend/reactivate or set the AI budget of an organisation (platform admins only). */
export const PUT = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("viewer");
  requirePlatformAdmin(user);
  const { id } = await params;
  const o = await updateOrg(id, Body.parse(await req.json()), user);
  return json({ id: o.id, status: o.status });
});
