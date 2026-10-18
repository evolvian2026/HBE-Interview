import { z } from "zod";
import { HttpError, requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { getSettings } from "@/lib/settings";
import { brandFor } from "@/lib/services/emails";
import { renderEmail, SAMPLE_VARS, TEMPLATE_KEYS, templateProblems, type TemplateKey } from "@/lib/core/templates";

const Body = z.object({ key: z.string(), subject: z.string().max(400), body: z.string().max(10_000) });

/** Render a draft with example values and the organisation's branding (admins). */
export const POST = handle(async (req: Request) => {
  const user = await requireStaff("admin");
  const b = Body.parse(await req.json());
  if (!(TEMPLATE_KEYS as string[]).includes(b.key)) throw new HttpError(404, "Unknown email");
  const key = b.key as TemplateKey;
  const s = await getSettings(user.orgId);
  const r = renderEmail(key, b, { ...SAMPLE_VARS, company: s.companyName }, await brandFor(user.orgId));
  return json({ subject: r.subject, html: r.html, problems: templateProblems(key, b) });
});
