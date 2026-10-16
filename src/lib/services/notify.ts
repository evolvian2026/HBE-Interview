import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { env } from "../env";
import { getSettings } from "../settings";

/** Send an email via Resend if configured; otherwise log (links are always visible to recruiters in the app). */
export async function sendEmail(to: string, subject: string, html: string) {
  if (!env.resendKey) {
    console.log(`[email:disabled] to=${to} subject=${subject}`);
    return false;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.resendKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env.emailFrom, to, subject, html }),
  });
  if (!res.ok) throw new Error(`Email send failed: ${res.status} ${await res.text()}`);
  return true;
}

export function candidateLink(accessToken: string) {
  return `${env.appBaseUrl.replace(/\/$/, "")}/c/${accessToken}`;
}

export async function sendInviteEmail(candidacyId: string) {
  const [row] = await db
    .select({ c: schema.candidacies, cand: schema.candidates, d: schema.drives })
    .from(schema.candidacies)
    .innerJoin(schema.candidates, eq(schema.candidacies.candidateId, schema.candidates.id))
    .innerJoin(schema.drives, eq(schema.candidacies.driveId, schema.drives.id))
    .where(eq(schema.candidacies.id, candidacyId));
  if (!row) return;
  const s = await getSettings();
  const link = candidateLink(row.c.accessToken);
  await sendEmail(
    row.cand.email,
    `Your interview for ${row.d.title} at ${s.companyName}`,
    `<p>Hi ${row.cand.name},</p><p>You're invited to an AI-conducted interview for <b>${row.d.title}</b> at ${s.companyName}.</p><p><a href="${link}">Start your interview</a></p><p>This is your personal link — keep it private. You can use it to come back to your interview at any time.</p>`,
  );
}

export async function notifyCandidateNextRound(candidacyId: string) {
  const [row] = await db
    .select({ c: schema.candidacies, cand: schema.candidates, d: schema.drives })
    .from(schema.candidacies)
    .innerJoin(schema.candidates, eq(schema.candidacies.candidateId, schema.candidates.id))
    .innerJoin(schema.drives, eq(schema.candidacies.driveId, schema.drives.id))
    .where(eq(schema.candidacies.id, candidacyId));
  if (!row) return;
  const s = await getSettings();
  await sendEmail(
    row.cand.email,
    `Next interview round for ${row.d.title}`,
    `<p>Hi ${row.cand.name},</p><p>Thank you for completing your previous round. Your next round for <b>${row.d.title}</b> at ${s.companyName} is now available${row.c.roundAvailableUntil ? ` until ${row.c.roundAvailableUntil.toDateString()}` : ""}.</p><p><a href="${candidateLink(row.c.accessToken)}">Continue your interview</a></p>`,
  );
}
