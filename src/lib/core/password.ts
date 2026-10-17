/** Staff password policy (pure). Returns a reason the password is unacceptable, or null. */
const COMMON = new Set(["password", "password1", "password123", "123456789", "1234567890", "qwerty123", "letmein123", "welcome123", "admin12345", "iloveyou12", "changeme123", "hbeinterview"]);

export const MIN_PASSWORD = 10;

export function passwordProblem(pw: string, email?: string, name?: string): string | null {
  if (pw.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (pw.length > 200) return "Use at most 200 characters.";
  const lower = pw.toLowerCase();
  if (COMMON.has(lower) || /^(.)\1+$/.test(pw)) return "This password is too common.";
  const local = email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) return "Don't include your email address in your password.";
  for (const part of (name ?? "").toLowerCase().split(/\s+/)) if (part.length >= 4 && lower.includes(part)) return "Don't include your name in your password.";
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (classes < 2 && pw.length < 16) return "Mix letters with numbers or symbols, or use a longer passphrase (16+ characters).";
  return null;
}
