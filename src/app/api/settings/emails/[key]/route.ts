import { z } from "zod";
import { HttpError, requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { audit } from "@/lib/audit";
import { getSettings, saveSettings } from "@/lib/settings";
import { TEMPLATE_KEYS, templateProblems, type TemplateKey } from "@/lib/core/templates";

const Body = z.object({ subject: z.string().max(400), body: z.string().max(10_000) });

function keyOf(raw: string): TemplateKey {
  if (!(TEMPLATE_KEYS as string[]).includes(raw)) throw new HttpError(404, "Unknown email");
  return raw as TemplateKey;
}

/** Save a customised candidate email (admins). */
export const PUT = handle(async (req: Request, { params }: { params: Promise<{ key: string }> }) => {
  const user = await requireStaff("admin");
  const key = keyOf((await params).key);
  const t = Body.parse(await req.json());
  const problems = templateProblems(key, t);
  if (problems.length) throw new HttpError(400, problems.join(" "));
  const current = (await getSettings(user.orgId)).emailTemplates ?? {};
  await saveSettings(user.orgId, { emailTemplates: { ...current, [key]: { subject: t.subject.trim(), body: t.body.trim() } } });
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "settings.email_template", "settings", key);
  return json({ ok: true });
});

/** Go back to the built-in text. */
export const DELETE = handle(async (_req: Request, { params }: { params: Promise<{ key: string }> }) => {
  const user = await requireStaff("admin");
  const key = keyOf((await params).key);
  const current = { ...((await getSettings(user.orgId)).emailTemplates ?? {}) };
  delete current[key];
  await saveSettings(user.orgId, { emailTemplates: current });
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "settings.email_template_reset", "settings", key);
  return json({ ok: true });
});
