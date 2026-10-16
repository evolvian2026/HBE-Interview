import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { saveSettings } from "@/lib/settings";
import { audit } from "@/lib/audit";

const Body = z.object({
  companyName: z.string().trim().min(1).max(120).optional(),
  companyBlurb: z.string().max(4000).optional(),
  supportEmail: z.string().max(200).optional(),
  values: z.array(z.object({ name: z.string().trim().min(1).max(80), description: z.string().max(500), behaviors: z.array(z.string().max(200)).max(6) })).min(1).max(8).optional(),
  askCompensation: z.boolean().optional(),
  retentionDays: z.number().int().min(30).max(730).optional(),
  consentText: z.string().min(50).max(8000).optional(),
});

export const PUT = handle(async (req: Request) => {
  const user = await requireStaff("admin");
  const patch = Body.parse(await req.json());
  const s = await saveSettings(patch);
  await audit({ type: "staff", id: user.id }, "settings.update", "settings", "org", Object.keys(patch));
  return json(s);
});
