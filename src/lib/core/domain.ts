/** Email-domain helpers for SSO routing (pure). */

/** Consumer mail providers: nobody can claim these as their organisation's domain. */
export const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "yahoo.co.in", "ymail.com", "icloud.com", "me.com", "mac.com",
  "aol.com", "proton.me", "protonmail.com", "zoho.com", "zohomail.in", "rediffmail.com", "gmx.com", "gmx.net", "mail.com", "yandex.com", "yandex.ru", "qq.com", "163.com", "tutanota.com", "fastmail.com", "hey.com",
]);

export function normalizeDomain(raw: string): string | null {
  const d = raw.trim().toLowerCase().replace(/^@/, "").replace(/\.$/, "");
  if (d.length > 253 || !/^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/.test(d)) return null;
  if (/^\d+(\.\d+)+$/.test(d)) return null; // IP address
  return d;
}

export function domainOfEmail(email: string): string | null {
  const at = email.lastIndexOf("@");
  return at > 0 ? normalizeDomain(email.slice(at + 1)) : null;
}

/** Why a domain can't be claimed, or null. */
export function domainProblem(domain: string): string | null {
  const d = normalizeDomain(domain);
  if (!d) return "Enter a domain like example.com";
  if (PUBLIC_EMAIL_DOMAINS.has(d)) return "Public email providers can't be used for single sign-on";
  if (d.endsWith(".local") || d.endsWith(".internal") || d === "localhost") return "Use a public domain";
  return null;
}

/** The TXT record value proving control of a domain. */
export const verificationRecord = (token: string) => `hbe-verification=${token}`;
