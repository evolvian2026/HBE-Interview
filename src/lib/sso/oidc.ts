import { createHash, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { env } from "../env";
import { isInternalHost } from "../core/webhook-sign";

/** Minimal OpenID Connect relying party: discovery, authorization code + PKCE, ID token verification. */

export interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

export class SsoError extends Error {}

const b64url = (b: Buffer) => b.toString("base64url");

/** Identity-provider URLs are admin-supplied and fetched server-side: HTTPS and public addresses only in production. */
export async function assertSafeIdpUrl(raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new SsoError("Invalid identity provider URL");
  }
  if (!env.isProduction) return u;
  if (u.protocol !== "https:") throw new SsoError("The identity provider must use HTTPS");
  if (isInternalHost(u.hostname)) throw new SsoError("The identity provider URL points to an internal address");
  const addrs = await lookup(u.hostname, { all: true }).catch(() => []);
  if (!addrs.length || addrs.some((a) => isInternalHost(a.address))) throw new SsoError("The identity provider host doesn't resolve to a public address");
  return u;
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  await assertSafeIdpUrl(url);
  const res = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(10_000) });
  const text = await res.text();
  if (!res.ok) throw new SsoError(`Identity provider returned ${res.status} for ${new URL(url).pathname}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new SsoError("Identity provider returned invalid JSON");
  }
}

const discoveryCache = new Map<string, { at: number; doc: Discovery }>();

export const normalizeIssuer = (issuer: string) => issuer.trim().replace(/\/+$/, "");

export async function discover(issuer: string): Promise<Discovery> {
  const iss = normalizeIssuer(issuer);
  const hit = discoveryCache.get(iss);
  if (hit && Date.now() - hit.at < 3600_000) return hit.doc;
  const doc = await getJson<Discovery>(`${iss}/.well-known/openid-configuration`);
  // OpenID Connect Discovery §4.3: the issuer in the document must match exactly.
  if (normalizeIssuer(doc.issuer ?? "") !== iss) throw new SsoError(`Issuer mismatch: configured ${iss}, provider says ${doc.issuer}`);
  for (const k of ["authorization_endpoint", "token_endpoint", "jwks_uri"] as const) {
    if (typeof doc[k] !== "string") throw new SsoError(`Discovery document is missing ${k}`);
    await assertSafeIdpUrl(doc[k]);
  }
  discoveryCache.set(iss, { at: Date.now(), doc });
  return doc;
}

export function newPkce() {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
}

export const randomToken = () => b64url(randomBytes(24));

export function authorizationUrl(d: Discovery, p: { clientId: string; redirectUri: string; state: string; nonce: string; challenge: string; loginHint?: string }) {
  const u = new URL(d.authorization_endpoint);
  u.search = new URLSearchParams({
    response_type: "code",
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    scope: "openid email profile",
    state: p.state,
    nonce: p.nonce,
    code_challenge: p.challenge,
    code_challenge_method: "S256",
    ...(p.loginHint ? { login_hint: p.loginHint } : {}),
  }).toString();
  return u.toString();
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export interface VerifiedIdentity {
  email: string;
  name: string;
  subject: string;
  claims: JWTPayload;
}

/** Exchange the code (client_secret_post + PKCE) and verify the ID token: signature, issuer, audience, expiry, nonce, verified email. */
export async function redeemCode(d: Discovery, p: { clientId: string; clientSecret: string; redirectUri: string; code: string; verifier: string; nonce: string }): Promise<VerifiedIdentity> {
  const tokens = await getJson<{ id_token?: string }>(d.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: p.code, redirect_uri: p.redirectUri, code_verifier: p.verifier, client_id: p.clientId, client_secret: p.clientSecret }).toString(),
  });
  if (!tokens.id_token) throw new SsoError("The identity provider didn't return an ID token");
  const keySet = (fresh: boolean) => {
    let jwks = fresh ? undefined : jwksCache.get(d.jwks_uri);
    if (!jwks) {
      jwks = createRemoteJWKSet(new URL(d.jwks_uri), { timeoutDuration: 10_000, cacheMaxAge: 10 * 60_000 });
      jwksCache.set(d.jwks_uri, jwks);
    }
    return jwks;
  };
  const verify = (fresh: boolean) =>
    jwtVerify(tokens.id_token!, keySet(fresh), { issuer: d.issuer, audience: p.clientId, algorithms: ["RS256", "RS384", "RS512", "PS256", "ES256", "ES384"], clockTolerance: 60 });
  let claims: JWTPayload;
  try {
    try {
      ({ payload: claims } = await verify(false));
    } catch (e) {
      // The provider may have rotated its keys under the same key id: refetch the key set once and retry.
      if ((e as { code?: string }).code !== "ERR_JWS_SIGNATURE_VERIFICATION_FAILED") throw e;
      ({ payload: claims } = await verify(true));
    }
  } catch (e) {
    throw new SsoError(`ID token rejected: ${(e as Error).message}`);
  }
  if (claims.nonce !== p.nonce) throw new SsoError("ID token nonce mismatch");
  if (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== p.clientId) throw new SsoError("ID token authorised party mismatch");
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  if (!email) throw new SsoError("The identity provider didn't share an email address (add the email scope/claim)");
  // Microsoft Entra omits email_verified for organisational accounts; other providers must assert it.
  const verified = claims.email_verified === true || claims.email_verified === "true" || (claims.email_verified === undefined && typeof claims.tid === "string");
  if (!verified) throw new SsoError("The identity provider hasn't verified this email address");
  const name = typeof claims.name === "string" && claims.name.trim() ? claims.name.trim().slice(0, 120) : email.split("@")[0];
  return { email, name, subject: String(claims.sub ?? ""), claims };
}

/** Forget cached discovery/JWKS for an issuer (after configuration changes). */
export function forgetIssuer(issuer: string) {
  const hit = discoveryCache.get(normalizeIssuer(issuer));
  if (hit) jwksCache.delete(hit.doc.jwks_uri);
  discoveryCache.delete(normalizeIssuer(issuer));
}
