import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { env } from "../env";

/** Short-lived signed cookie carrying the OIDC state, nonce and PKCE verifier between /start and /callback. */
const COOKIE = "hbe_sso";
const key = () => new TextEncoder().encode(`${env.sessionSecret}:sso-state`);

export interface SsoState {
  state: string;
  nonce: string;
  verifier: string;
  orgId: string;
  test: boolean;
  next?: string;
}

export async function saveSsoState(s: SsoState) {
  const token = await new SignJWT({ ...s }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("10m").sign(key());
  // Lax: the identity provider redirects back with a top-level GET, which Lax cookies accompany.
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: env.isProduction, path: "/api/auth/sso", maxAge: 600 });
}

export async function takeSsoState(): Promise<SsoState | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  jar.delete({ name: COOKIE, path: "/api/auth/sso" });
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    return payload as unknown as SsoState;
  } catch {
    return null;
  }
}

export const redirectUri = () => `${env.appBaseUrl.replace(/\/$/, "")}/api/auth/sso/callback`;
