import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, hotp, newRecoveryCodes, otpauthUri, totp, verifyTotp } from "@/lib/core/totp";
import { passwordProblem } from "@/lib/core/password";
import { csvCell } from "@/lib/csv";

describe("TOTP (RFC 6238 / RFC 4226)", () => {
  const secret = Buffer.from("12345678901234567890");
  it("matches the RFC 6238 SHA-1 test vectors (8 digits)", () => {
    const vectors: [number, string][] = [
      [59, "94287082"],
      [1111111109, "07081804"],
      [1111111111, "14050471"],
      [1234567890, "89005924"],
      [2000000000, "69279037"],
      [20000000000, "65353130"],
    ];
    for (const [t, want] of vectors) expect(totp(secret, t * 1000, { digits: 8 })).toBe(want);
  });
  it("matches the RFC 4226 HOTP vectors", () => {
    expect([0, 1, 2, 3, 9].map((c) => hotp(secret, c))).toEqual(["755224", "287082", "359152", "969429", "520489"]);
  });
  it("round-trips base32 and accepts ±1 step of drift but not replays", () => {
    const b = Buffer.from("hello two-factor world");
    expect(base32Decode(base32Encode(b)).equals(b)).toBe(true);
    const now = 1_760_000_000_000;
    const code = totp(secret, now);
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(secret, code, now)).toBe(step);
    expect(verifyTotp(secret, code, now + 30_000)).toBe(step);
    expect(verifyTotp(secret, code, now + 90_000)).toBeNull();
    expect(verifyTotp(secret, code, now, step)).toBeNull();
    expect(verifyTotp(secret, "abc123", now)).toBeNull();
  });
  it("makes well-formed recovery codes and otpauth URIs", () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(codes.every((c) => /^[A-Z2-7]{4}-[A-Z2-7]{4}$/.test(c))).toBe(true);
    expect(otpauthUri("JBSWY3DPEHPK3PXP", "a@b.com")).toBe("otpauth://totp/HBE%20Interview%3Aa%40b.com?secret=JBSWY3DPEHPK3PXP&issuer=HBE%20Interview&algorithm=SHA1&digits=6&period=30");
  });
});

describe("password policy", () => {
  it("rejects weak passwords and accepts reasonable ones", () => {
    expect(passwordProblem("short1!")).toMatch(/at least/);
    expect(passwordProblem("password123")).toMatch(/common/);
    expect(passwordProblem("aaaaaaaaaaaa")).toMatch(/common/);
    expect(passwordProblem("priya-Secure-1", "priya@x.com")).toMatch(/email/);
    expect(passwordProblem("Sharma-Secure-1", "p@x.com", "Priya Sharma")).toMatch(/name/);
    expect(passwordProblem("onlylowercase")).toMatch(/Mix/);
    expect(passwordProblem("correct horse battery staple")).toBeNull();
    expect(passwordProblem("Blue-Kettle-44")).toBeNull();
  });
});

describe("secret sealing", () => {
  it("encrypts and authenticates", async () => {
    process.env.SESSION_SECRET ??= "x".repeat(40);
    const { seal, unseal } = await import("@/lib/security/secrets");
    const sealed = seal("JBSWY3DPEHPK3PXP");
    expect(sealed).toMatch(/^v1\./);
    expect(sealed).not.toContain("JBSWY3DPEHPK3PXP");
    expect(seal("same")).not.toBe(seal("same"));
    expect(unseal(sealed)).toBe("JBSWY3DPEHPK3PXP");
    const parts = sealed.split(".");
    parts[2] = parts[2].slice(0, -2) + (parts[2].endsWith("A") ? "BB" : "AA");
    expect(() => unseal(parts.join("."))).toThrow();
  });
});

describe("CSV export cells", () => {
  it("quotes, serialises objects and neutralises formulas", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
    expect(csvCell(null)).toBe('""');
    for (const f of ["=1+1", "+cmd", "-2", "@SUM(A1)"]) expect(csvCell(f).startsWith(`"'`)).toBe(true);
  });
});
