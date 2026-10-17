import { NextResponse } from "next/server";
import { getStaff } from "@/lib/auth/staff";
import { env } from "@/lib/env";
import { authorizationUrl, discover, newPkce, randomToken } from "@/lib/sso/oidc";
import { redirectUri, saveSsoState } from "@/lib/sso/flow";
import { getSsoConfig, ssoForEmail } from "@/lib/services/sso";
import { clientIp, hit } from "@/lib/security/rate-limit";

const back = (path: string, msg: string) => NextResponse.redirect(new URL(`${path}${path.includes("?") ? "&" : "?"}sso_error=${encodeURIComponent(msg)}`, env.appBaseUrl), 303);

/**
 * Begin single sign-on. `?email=` routes to the organisation that verified the email's domain; `?test=1` (admins) runs
 * the flow against their own organisation's configuration without signing anyone in.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const test = url.searchParams.get("test") === "1";
  if ((await hit(`sso-start:${clientIp(req)}`, 15 * 60)) > 60) return back("/login", "Too many sign-in attempts — please wait a few minutes.");
  let cfg;
  if (test) {
    const user = await getStaff();
    if (!user || user.role !== "admin") return back("/login", "Sign in as an administrator to test single sign-on.");
    cfg = await getSsoConfig(user.orgId);
    if (!cfg) return back("/app/settings", "Save the single sign-on settings first.");
  } else {
    const email = (url.searchParams.get("email") ?? "").trim().toLowerCase();
    cfg = email ? await ssoForEmail(email) : null;
    if (!cfg) return back("/login", "Single sign-on isn't set up for that email domain. Sign in with your password, or ask your administrator.");
  }
  try {
    const d = await discover(cfg.issuer);
    const pkce = newPkce();
    const state = randomToken();
    const nonce = randomToken();
    await saveSsoState({ state, nonce, verifier: pkce.verifier, orgId: cfg.orgId, test });
    return NextResponse.redirect(authorizationUrl(d, { clientId: cfg.clientId, redirectUri: redirectUri(), state, nonce, challenge: pkce.challenge, loginHint: url.searchParams.get("email") ?? undefined }), 303);
  } catch (e) {
    return back(test ? "/app/settings" : "/login", `Couldn't reach your identity provider: ${(e as Error).message}`);
  }
}
