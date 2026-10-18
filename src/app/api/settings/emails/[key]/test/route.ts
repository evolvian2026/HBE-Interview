import { HttpError, requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { getSettings } from "@/lib/settings";
import { limit } from "@/lib/security/rate-limit";
import { brandFor, templateText } from "@/lib/services/emails";
import { sendEmail } from "@/lib/services/notify";
import { renderEmail, SAMPLE_VARS, TEMPLATE_KEYS, type TemplateKey } from "@/lib/core/templates";

/** Send the saved version of an email, with example values, to yourself (admins). */
export const POST = handle(async (_req: Request, { params }: { params: Promise<{ key: string }> }) => {
  const user = await requireStaff("admin");
  const raw = (await params).key;
  if (!(TEMPLATE_KEYS as string[]).includes(raw)) throw new HttpError(404, "Unknown email");
  await limit(`email-test:${user.id}`, 20, 60 * 60);
  const key = raw as TemplateKey;
  const s = await getSettings(user.orgId);
  const r = renderEmail(key, await templateText(user.orgId, key), { ...SAMPLE_VARS, company: s.companyName }, await brandFor(user.orgId));
  const sent = await sendEmail(user.email, `[Test] ${r.subject}`, r.html, r.text);
  return json({ sent, to: user.email });
});
