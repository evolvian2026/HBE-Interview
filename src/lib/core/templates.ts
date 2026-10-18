/**
 * Candidate email templates (pure): definitions, validation and safe rendering into a branded HTML layout.
 * Templates are plain text with {{placeholders}}; a blank line starts a new paragraph and a paragraph that is just
 * {{link}} becomes a button. Everything — template text and values — is HTML-escaped.
 */

export const PLACEHOLDERS = {
  candidate_name: "Candidate's full name",
  first_name: "Candidate's first name",
  company: "Your company name",
  role: "Hiring drive title",
  link: "The candidate's personal interview link",
  deadline: "Date the invitation or round closes",
  interview_title: "Panel interview title",
  interview_time: "Panel interview time (UTC; their page shows local time)",
  duration: "Panel interview length in minutes",
  location: "Panel interview place or video link",
  note: "Note from the hiring team",
} as const;

export type Placeholder = keyof typeof PLACEHOLDERS;
export type TemplateVars = Partial<Record<Placeholder, string>>;

export interface TemplateDef {
  label: string;
  when: string;
  placeholders: Placeholder[];
  required: Placeholder[];
  button: string;
  subject: string;
  body: string;
}

const BASE: Placeholder[] = ["candidate_name", "first_name", "company", "role", "link"];

export const TEMPLATES = {
  invite: {
    label: "Invitation",
    when: "A candidate is invited, registers through an open link, or is re-invited from the talent pool.",
    placeholders: [...BASE, "deadline"],
    required: ["link"],
    button: "Start your interview",
    subject: "Your interview for {{role}} at {{company}}",
    body: "Hi {{first_name}},\n\nYou're invited to an AI-conducted interview for {{role}} at {{company}}.\n\n{{link}}\n\nThis is your personal link — keep it private. You can use it to come back to your interview at any time. Please complete it by {{deadline}}.",
  },
  reminder: {
    label: "Reminder",
    when: "Two days before an invitation or a round's window closes.",
    placeholders: [...BASE, "deadline"],
    required: ["link"],
    button: "Continue your interview",
    subject: "Reminder: your interview for {{role}}",
    body: "Hi {{first_name}},\n\nThis is a friendly reminder that your interview for {{role}} at {{company}} is waiting for you and is available until {{deadline}}.\n\n{{link}}",
  },
  next_round: {
    label: "Next round available",
    when: "A round is passed and the next one unlocks.",
    placeholders: [...BASE, "deadline"],
    required: ["link"],
    button: "Continue your interview",
    subject: "Next interview round for {{role}}",
    body: "Hi {{first_name}},\n\nThank you for completing your previous round. Your next round for {{role}} at {{company}} is now available until {{deadline}}.\n\n{{link}}",
  },
  panel_choose: {
    label: "Panel interview: choose a time",
    when: "The recruiter offers several times for a panel interview.",
    placeholders: [...BASE, "interview_title", "duration"],
    required: ["link"],
    button: "Choose a time",
    subject: "{{interview_title}} — {{role}}",
    body: "Hi {{first_name}},\n\nThe hiring team at {{company}} would like to meet you for a {{duration}}-minute {{interview_title}}. Please choose a time that suits you.\n\n{{link}}",
  },
  panel_confirmed: {
    label: "Panel interview: confirmed",
    when: "A panel interview is booked.",
    placeholders: [...BASE, "interview_title", "interview_time", "duration", "location"],
    required: ["interview_time"],
    button: "Your interview page",
    subject: "Confirmed: {{interview_title}} — {{role}}",
    body: "Hi {{first_name}},\n\nYour {{interview_title}} with {{company}} is confirmed for {{interview_time}} ({{duration}} minutes) at {{location}}.\n\nYour interview page shows the time in your time zone and has a calendar file.\n\n{{link}}",
  },
  panel_cancelled: {
    label: "Panel interview: cancelled",
    when: "A recruiter cancels a panel interview.",
    placeholders: [...BASE, "interview_title"],
    required: [],
    button: "Your interview page",
    subject: "Cancelled: {{interview_title}} — {{role}}",
    body: "Hi {{first_name}},\n\nYour {{interview_title}} with {{company}} has been cancelled. The hiring team will be in touch.",
  },
  adjustment_approved: {
    label: "Adjustments approved",
    when: "A recruiter approves a candidate's request for extra time or breaks.",
    placeholders: [...BASE, "note"],
    required: [],
    button: "Open your interview page",
    subject: "Your interview adjustment request — {{role}}",
    body: "Hi {{first_name}},\n\nYour adjustment request for {{role}} at {{company}} has been approved and will apply to the rounds you haven't started yet.\n\n{{note}}\n\n{{link}}",
  },
  adjustment_declined: {
    label: "Adjustments declined",
    when: "A recruiter declines a candidate's adjustment request (a note is always given).",
    placeholders: [...BASE, "note"],
    required: ["note"],
    button: "Open your interview page",
    subject: "Your interview adjustment request — {{role}}",
    body: "Hi {{first_name}},\n\n{{company}} couldn't approve your adjustment request for {{role}}.\n\n{{note}}\n\n{{link}}",
  },
  offer: {
    label: "Decision: offer",
    when: "A final decision to make an offer is recorded and the team chooses to tell the candidate.",
    placeholders: [...BASE],
    required: [],
    button: "Your interview page",
    subject: "Your application for {{role}}",
    body: "Hi {{first_name}},\n\nThank you for interviewing for {{role}}. We're delighted to tell you that {{company}} would like to make you an offer. A member of the team will contact you shortly with the details.",
  },
  reject: {
    label: "Decision: not moving forward",
    when: "A final decision to reject is recorded and the team chooses to tell the candidate.",
    placeholders: [...BASE],
    required: [],
    button: "Your interview page",
    subject: "Your application for {{role}}",
    body: "Hi {{first_name}},\n\nThank you for the time and effort you put into interviewing for {{role}} at {{company}}. After careful consideration, we won't be moving forward with your application this time. We appreciate your interest and wish you every success.",
  },
} satisfies Record<string, TemplateDef>;

export type TemplateKey = keyof typeof TEMPLATES;
export const TEMPLATE_KEYS = Object.keys(TEMPLATES) as TemplateKey[];

export interface TemplateText {
  subject: string;
  body: string;
}

const TOKEN = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** Problems with an edited template, or [] when it's fine. */
export function templateProblems(key: TemplateKey, t: TemplateText): string[] {
  const def: TemplateDef = TEMPLATES[key];
  const out: string[] = [];
  if (!t.subject.trim()) out.push("The subject can't be empty.");
  if (t.subject.length > 200) out.push("The subject is longer than 200 characters.");
  if (/[\r\n]/.test(t.subject)) out.push("The subject must be a single line.");
  if (!t.body.trim()) out.push("The message can't be empty.");
  if (t.body.length > 5000) out.push("The message is longer than 5,000 characters.");
  const used = new Set<string>();
  for (const m of `${t.subject}\n${t.body}`.matchAll(TOKEN)) used.add(m[1]);
  for (const u of used) if (!(def.placeholders as string[]).includes(u)) out.push(`{{${u}}} isn't available in this email.`);
  for (const r of def.required) if (!used.has(r)) out.push(`{{${r}}} must appear in this email.`);
  if (/\{\{(?![\s]*[a-z_]+[\s]*\}\})/.test(`${t.subject}${t.body}`)) out.push("There's an unfinished {{placeholder}}.");
  return [...new Set(out)];
}

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

const safeUrl = (u: string | undefined) => (u && /^https?:\/\//i.test(u) ? u : "");

export interface Brand {
  companyName: string;
  color: string;
  /** Absolute URL of the organisation's logo, if it has one. */
  logoUrl: string | null;
}

export interface Rendered {
  subject: string;
  html: string;
  text: string;
}

/** Fill a template and wrap it in the branded layout. Unknown or missing values render as nothing. */
export function renderEmail(key: TemplateKey, t: TemplateText, vars: TemplateVars, brand: Brand): Rendered {
  const def: TemplateDef = TEMPLATES[key];
  const value = (name: string) => (name in PLACEHOLDERS ? (vars[name as Placeholder] ?? "").toString() : "");
  const subject = t.subject.replace(TOKEN, (_, n) => value(n)).replace(/\s+/g, " ").trim();
  const link = safeUrl(vars.link);
  const color = /^#[0-9a-f]{6}$/i.test(brand.color) ? brand.color : "#4f46e5";
  const paragraphs = t.body
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const textParas: string[] = [];
  const htmlParas: string[] = [];
  for (const p of paragraphs) {
    if (/^\{\{\s*link\s*\}\}$/.test(p)) {
      if (!link) continue;
      htmlParas.push(`<p style="margin:24px 0"><a href="${escapeHtml(link)}" style="background:${color};color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;font-weight:600">${escapeHtml(def.button)}</a></p>`);
      textParas.push(`${def.button}: ${link}`);
      continue;
    }
    const filledText = p.replace(TOKEN, (_, n) => value(n)).trim();
    if (!filledText) continue; // e.g. an empty {{note}} paragraph
    // Escape the template text and each value separately; links become anchors.
    let html = "";
    let last = 0;
    for (const m of p.matchAll(TOKEN)) {
      html += escapeHtml(p.slice(last, m.index));
      const v = value(m[1]);
      html += m[1] === "link" && link ? `<a href="${escapeHtml(link)}" style="color:${color}">${escapeHtml(link)}</a>` : escapeHtml(v);
      last = m.index! + m[0].length;
    }
    html += escapeHtml(p.slice(last));
    htmlParas.push(`<p style="margin:0 0 14px">${html.replace(/\n/g, "<br>")}</p>`);
    textParas.push(filledText);
  }
  const header = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.companyName)}" height="36" style="height:36px;max-width:220px">`
    : `<span style="font-size:18px;font-weight:700;color:${color}">${escapeHtml(brand.companyName)}</span>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a"><div style="max-width:560px;margin:0 auto;padding:24px"><div style="padding:8px 0 16px">${header}</div><div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;font-size:15px;line-height:1.55">${htmlParas.join("")}</div><p style="font-size:12px;color:#64748b;margin:16px 4px">Sent by HBE Interview on behalf of ${escapeHtml(brand.companyName)}.</p></div></body></html>`;
  return { subject, html, text: textParas.join("\n\n") };
}

/** Example values for previews and test sends. */
export const SAMPLE_VARS: TemplateVars = {
  candidate_name: "Priya Sharma",
  first_name: "Priya",
  role: "Senior Backend Engineer",
  link: "https://interview.example.com/c/sample-link",
  deadline: "Friday 24 October 2026",
  interview_title: "Final panel interview",
  interview_time: "Tue, 28 Oct 2026, 09:30 UTC",
  duration: "60",
  location: "https://meet.example.com/abc-defg",
  note: "We've approved 50% extra time for each remaining round.",
};
