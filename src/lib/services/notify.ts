import { env } from "../env";

/** Send an email via Resend if configured; otherwise log (links are always visible to recruiters in the app). */
export async function sendEmail(to: string, subject: string, html: string, text?: string) {
  if (!env.resendKey) {
    console.log(`[email:disabled] to=${to} subject=${subject}`);
    return false;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.resendKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env.emailFrom, to, subject, html, ...(text ? { text } : {}) }),
  });
  if (!res.ok) throw new Error(`Email send failed: ${res.status} ${await res.text()}`);
  return true;
}

export function candidateLink(accessToken: string) {
  return `${env.appBaseUrl.replace(/\/$/, "")}/c/${accessToken}`;
}

/* Candidate emails use the organisation's templates and branding (services/emails.ts); imported lazily to avoid a cycle. */

export async function sendInviteEmail(candidacyId: string) {
  const { sendCandidateEmail } = await import("./emails");
  await sendCandidateEmail(candidacyId, "invite");
}

export async function notifyCandidateNextRound(candidacyId: string) {
  const { sendCandidateEmail } = await import("./emails");
  await sendCandidateEmail(candidacyId, "next_round");
}

/** Remind a candidate whose invitation or next-round window expires within 48 hours (B-2). */
export async function sendReminderEmail(candidacyId: string) {
  const { sendCandidateEmail } = await import("./emails");
  await sendCandidateEmail(candidacyId, "reminder");
}
