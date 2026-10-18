import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { env } from "../env";
import { getSettings } from "../settings";
import { getBranding } from "../branding";
import { renderEmail, TEMPLATES, type TemplateKey, type TemplateText, type TemplateVars } from "../core/templates";
import { candidateLink, sendEmail } from "./notify";

const absolute = (path: string) => `${env.appBaseUrl.replace(/\/$/, "")}${path}`;

/** The organisation's text for a template: its customised version, or the built-in default. */
export async function templateText(orgId: string, key: TemplateKey): Promise<TemplateText & { custom: boolean }> {
  const custom = (await getSettings(orgId)).emailTemplates?.[key];
  const def = TEMPLATES[key];
  return custom ? { ...custom, custom: true } : { subject: def.subject, body: def.body, custom: false };
}

export async function brandFor(orgId: string) {
  const b = await getBranding(orgId);
  return { companyName: b.name, color: b.brandColor ?? "#4f46e5", logoUrl: b.logoUrl ? absolute(b.logoUrl) : null };
}

/** Standard values for a candidacy: names, company, role and the personal link. */
export async function candidateVars(candidacyId: string): Promise<{ to: string; orgId: string; vars: TemplateVars } | null> {
  const [row] = await db
    .select({ c: schema.candidacies, cand: schema.candidates, d: schema.drives })
    .from(schema.candidacies)
    .innerJoin(schema.candidates, eq(schema.candidacies.candidateId, schema.candidates.id))
    .innerJoin(schema.drives, eq(schema.candidacies.driveId, schema.drives.id))
    .where(eq(schema.candidacies.id, candidacyId));
  if (!row) return null;
  const s = await getSettings(row.c.orgId);
  const deadline = row.c.stage === "round_available" ? row.c.roundAvailableUntil : row.c.expiresAt;
  return {
    to: row.cand.email,
    orgId: row.c.orgId,
    vars: {
      candidate_name: row.cand.name,
      first_name: row.cand.name.trim().split(/\s+/)[0] ?? row.cand.name,
      company: s.companyName,
      role: row.d.title,
      link: candidateLink(row.c.accessToken),
      deadline: deadline ? deadline.toDateString() : "the date in your invitation",
    },
  };
}

/** Render and send a candidate email with the organisation's template and branding, and log the outcome. */
export async function sendCandidateEmail(candidacyId: string, key: TemplateKey, extra: TemplateVars = {}) {
  const base = await candidateVars(candidacyId);
  if (!base) return;
  const t = await templateText(base.orgId, key);
  const r = renderEmail(key, t, { ...base.vars, ...extra }, await brandFor(base.orgId));
  let status: "sent" | "failed" | "not_configured" = "sent";
  let error: string | null = null;
  try {
    if (!(await sendEmail(base.to, r.subject, r.html, r.text))) status = "not_configured";
  } catch (e) {
    status = "failed";
    error = (e as Error).message.slice(0, 500);
    console.error("candidate email failed", key, e);
  }
  await db.insert(schema.emailLog).values({ orgId: base.orgId, candidacyId, to: base.to, template: key, subject: r.subject, status, error });
  return status;
}

export async function emailsFor(candidacyId: string) {
  return db.select().from(schema.emailLog).where(eq(schema.emailLog.candidacyId, candidacyId)).orderBy(desc(schema.emailLog.createdAt)).limit(50);
}

export async function recentEmailFailures(orgId: string) {
  return db.select().from(schema.emailLog).where(and(eq(schema.emailLog.orgId, orgId), eq(schema.emailLog.status, "failed"))).orderBy(desc(schema.emailLog.createdAt)).limit(20);
}
