/**
 * Minimal OpenID Connect provider for local testing of single sign-on (not for production use).
 * Endpoints: discovery, /authorize (auto-approves the user named by login_hint), /token (code + PKCE S256 + client
 * secret), /jwks. `tamper` makes it misbehave so the relying party's checks can be exercised.
 *
 *   npx tsx scripts/mock-oidc.ts            # standalone on :4610 with client "hbe-test" / "hbe-secret"
 */
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";

export type Tamper = "none" | "aud" | "iss" | "nonce" | "expired" | "unverified" | "foreign-key" | "no-email";

export interface MockIdp {
  issuer: string;
  clientId: string;
  clientSecret: string;
  tamper: Tamper;
  /** Users the IdP knows: email → display name. Unknown login_hints are rejected. */
  users: Map<string, string>;
  close: () => Promise<void>;
}

export async function startMockIdp(port = 4610, clientId = "hbe-test", clientSecret = "hbe-secret"): Promise<MockIdp> {
  const issuer = `http://127.0.0.1:${port}`;
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const foreign = await generateKeyPair("RS256");
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const codes = new Map<string, { email: string; nonce: string; challenge: string; redirectUri: string; at: number }>();
  const idp: MockIdp = { issuer, clientId, clientSecret, tamper: "none", users: new Map(), close: async () => undefined };

  const send = (res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", issuer);
    if (url.pathname === "/.well-known/openid-configuration") {
      return send(res, 200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (url.pathname === "/jwks") return send(res, 200, { keys: [jwk] });
    if (url.pathname === "/authorize") {
      const p = url.searchParams;
      const redirect = p.get("redirect_uri") ?? "";
      if (p.get("client_id") !== clientId || p.get("response_type") !== "code" || p.get("code_challenge_method") !== "S256" || !p.get("code_challenge")) return send(res, 400, { error: "invalid_request" });
      const email = (p.get("login_hint") ?? "").toLowerCase();
      const back = new URL(redirect);
      if (!idp.users.has(email)) {
        back.searchParams.set("error", "access_denied");
        back.searchParams.set("error_description", "User not found at the identity provider");
      } else {
        const code = randomBytes(16).toString("hex");
        codes.set(code, { email, nonce: p.get("nonce") ?? "", challenge: p.get("code_challenge")!, redirectUri: redirect, at: Date.now() });
        back.searchParams.set("code", code);
      }
      back.searchParams.set("state", p.get("state") ?? "");
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    if (url.pathname === "/token" && req.method === "POST") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const f = new URLSearchParams(raw);
      const basic = req.headers.authorization?.startsWith("Basic ") ? Buffer.from(req.headers.authorization.slice(6), "base64").toString().split(":") : null;
      const [cid, csec] = basic ?? [f.get("client_id"), f.get("client_secret")];
      if (cid !== clientId || csec !== clientSecret) return send(res, 401, { error: "invalid_client" });
      const grant = codes.get(f.get("code") ?? "");
      codes.delete(f.get("code") ?? ""); // single use
      if (!grant || Date.now() - grant.at > 60_000 || grant.redirectUri !== f.get("redirect_uri")) return send(res, 400, { error: "invalid_grant" });
      const challenge = createHash("sha256").update(f.get("code_verifier") ?? "").digest("base64url");
      if (challenge !== grant.challenge) return send(res, 400, { error: "invalid_grant", error_description: "PKCE verification failed" });
      const t = idp.tamper;
      const now = Math.floor(Date.now() / 1000);
      const claims: Record<string, unknown> = {
        sub: createHash("sha256").update(grant.email).digest("hex").slice(0, 20),
        name: idp.users.get(grant.email),
        nonce: t === "nonce" ? "wrong-nonce" : grant.nonce,
        ...(t === "no-email" ? {} : { email: grant.email, email_verified: t !== "unverified" }),
      };
      const id_token = await new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setIssuer(t === "iss" ? "http://evil.example" : issuer)
        .setAudience(t === "aud" ? "someone-else" : clientId)
        .setIssuedAt(t === "expired" ? now - 7200 : now)
        .setExpirationTime(t === "expired" ? now - 3600 : now + 600)
        .sign(t === "foreign-key" ? foreign.privateKey : privateKey);
      return send(res, 200, { access_token: randomBytes(16).toString("hex"), token_type: "Bearer", expires_in: 600, id_token });
    }
    send(res, 404, { error: "not_found" });
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  idp.close = () => new Promise((r) => server.close(() => r()));
  return idp;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startMockIdp().then((idp) => {
    idp.users.set("demo@example.com", "Demo User");
    console.log(`Mock OIDC provider at ${idp.issuer} (client ${idp.clientId} / ${idp.clientSecret})`);
  });
}
