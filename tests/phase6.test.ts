import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { domainOfEmail, domainProblem, normalizeDomain } from "@/lib/core/domain";
import { brandColorProblem, brandVars, contrast, darkEnough } from "@/lib/core/brand";
import { authorizationUrl, discover, newPkce, redeemCode, SsoError } from "@/lib/sso/oidc";
import { startMockIdp, type MockIdp } from "../scripts/mock-oidc";

describe("email domains", () => {
  it("normalises and validates", () => {
    expect(normalizeDomain(" @Example.COM. ")).toBe("example.com");
    expect(normalizeDomain("sub.example.co.in")).toBe("sub.example.co.in");
    expect(normalizeDomain("not a domain")).toBeNull();
    expect(normalizeDomain("10.0.0.1")).toBeNull();
    expect(normalizeDomain("-bad.com")).toBeNull();
    expect(domainOfEmail("Priya@Acme.io")).toBe("acme.io");
    expect(domainProblem("gmail.com")).toMatch(/Public email/);
    expect(domainProblem("corp.local")).toMatch(/public domain/);
    expect(domainProblem("acme.io")).toBeNull();
  });
});

describe("brand colours", () => {
  it("computes WCAG contrast", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrast("#767676", "#ffffff")).toBeGreaterThanOrEqual(4.5); // the classic AA grey
  });
  it("accepts readable colours and suggests a darker shade for light ones", () => {
    expect(brandColorProblem("#0f766e")).toBeNull();
    expect(brandColorProblem("#ffd166")).toMatch(/too light/);
    expect(brandColorProblem("teal")).toMatch(/hex/);
    const fixed = darkEnough("#ffd166");
    expect(contrast(fixed, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    const v = brandVars("#0f766e");
    expect(v["--color-brand-600"]).toBe("#0f766e");
    expect(contrast(v["--color-brand-700"], "#ffffff")).toBeGreaterThan(contrast("#0f766e", "#ffffff"));
  });
});

describe("OpenID Connect client against the mock provider", () => {
  let idp: MockIdp;
  const redirectUri = "http://localhost:3000/api/auth/sso/callback";
  beforeAll(async () => {
    idp = await startMockIdp(4611);
    idp.users.set("asha@acme.io", "Asha Rao");
  });
  afterAll(() => idp.close());

  async function signIn(email: string) {
    const d = await discover(idp.issuer);
    const pkce = newPkce();
    const url = authorizationUrl(d, { clientId: idp.clientId, redirectUri, state: "s1", nonce: "n1", challenge: pkce.challenge, loginHint: email });
    const res = await fetch(url, { redirect: "manual" });
    const back = new URL(res.headers.get("location")!);
    expect(back.searchParams.get("state")).toBe("s1");
    return redeemCode(d, { clientId: idp.clientId, clientSecret: idp.clientSecret, redirectUri, code: back.searchParams.get("code") ?? "", verifier: pkce.verifier, nonce: "n1" });
  }

  it("verifies a good ID token", async () => {
    idp.tamper = "none";
    const id = await signIn("asha@acme.io");
    expect(id).toMatchObject({ email: "asha@acme.io", name: "Asha Rao" });
  });
  it.each(["aud", "iss", "nonce", "expired", "unverified", "foreign-key", "no-email"] as const)("rejects a token with tamper=%s", async (t) => {
    idp.tamper = t;
    await expect(signIn("asha@acme.io")).rejects.toBeInstanceOf(SsoError);
    idp.tamper = "none";
  });
  it("rejects a wrong PKCE verifier", async () => {
    const d = await discover(idp.issuer);
    const pkce = newPkce();
    const url = authorizationUrl(d, { clientId: idp.clientId, redirectUri, state: "s", nonce: "n", challenge: pkce.challenge, loginHint: "asha@acme.io" });
    const code = new URL((await fetch(url, { redirect: "manual" })).headers.get("location")!).searchParams.get("code")!;
    await expect(redeemCode(d, { clientId: idp.clientId, clientSecret: idp.clientSecret, redirectUri, code, verifier: newPkce().verifier, nonce: "n" })).rejects.toThrow(/PKCE|invalid_grant/);
  });
});
