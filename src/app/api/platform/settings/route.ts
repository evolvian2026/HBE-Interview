import { z } from "zod";
import { requirePlatformAdmin, requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { MODEL_CHOICES, savePlatformSettings } from "@/lib/settings";
import { audit } from "@/lib/audit";

const Body = z.object({
  models: z
    .object({ interviewer: z.string().max(60), analyzer: z.string().max(60), evaluator: z.string().max(60), utility: z.string().max(60) })
    .refine((m) => Object.values(m).every((v) => v === "" || MODEL_CHOICES.includes(v)), "Unknown model")
    .optional(),
  interviewerEffort: z.enum(["", "low", "medium", "high"]).optional(),
});

/** Platform-wide model overrides (platform admins only). */
export const PUT = handle(async (req: Request) => {
  const user = await requireStaff("viewer");
  requirePlatformAdmin(user);
  const patch = Body.parse(await req.json());
  const s = await savePlatformSettings(patch);
  await audit({ type: "staff", id: user.id, orgId: user.homeOrgId }, "platform.settings", "settings", "platform", Object.keys(patch));
  return json(s);
});
