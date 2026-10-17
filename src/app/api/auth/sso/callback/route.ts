import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { createStaffSession } from "@/lib/auth/staff";
import { env } from "@/lib/env";
import { audit } from "@/lib/audit";
import { domainOfEmail } from "@/lib/core/domain";
import { discover, redeemCode, SsoError } from "@/lib/sso/oidc";
import { redirectUri, takeSsoState } from "@/lib/sso/flow";
import { getSsoConfig, markSsoTested, resolveSsoUser, ssoSecret } from "@/lib/services/sso";

const to = (path: string) => NextResponse.redirect(new URL(path, env.appBaseUrl), 303);
const fail = (test: boolean, msg: string) => to(`${test ? "/app/settings" : "/login"}?sso_error=${encodeURIComponent(msg)}#sso`);

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** OIDC redirect target: validate state, redeem the code, verify the ID token, then sign the user in. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const st = await takeSsoState();
  if (!st) return fail(false, "Your sign-in took too long or was started in another browser. Please try again.");
  if (url.searchParams.get("error")) return fail(st.test, `Your identity provider refused the sign-in: ${url.searchParams.get("error_description") ?? url.searchParams.get("error")}`);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (!code || !same(state, st.state)) return fail(st.test, "Sign-in response didn't match the request. Please try again.");
  const cfg = await getSsoConfig(st.orgId);
  if (!cfg || (!cfg.enabled && !st.test)) return fail(st.test, "Single sign-on is not enabled for this organisation.");
  try {
    const d = await discover(cfg.issuer);
    const identity = await redeemCode(d, { clientId: cfg.clientId, clientSecret: ssoSecret(cfg), redirectUri: redirectUri(), code, verifier: st.verifier, nonce: st.nonce });
    if (st.test) {
      const [owned] = await db.select().from(schema.orgDomains).where(eq(schema.orgDomains.domain, domainOfEmail(identity.email) ?? ""));
      if (!owned || owned.orgId !== st.orgId || !owned.verifiedAt) return fail(true, `The identity provider works, but ${identity.email} isn't in one of your verified domains.`);
      await markSsoTested(st.orgId);
      await audit({ type: "system", orgId: st.orgId }, "settings.sso_tested", "sso_config", st.orgId, { email: identity.email });
      return to(`/app/settings?sso_test=${encodeURIComponent(identity.email)}#sso`);
    }
    const { user, created } = await resolveSsoUser(st.orgId, identity, { test: false });
    await db.update(schema.users).set({ failedLogins: 0, lockedUntil: null }).where(eq(schema.users.id, user.id));
    await createStaffSession(user, undefined, { sso: true });
    await audit({ type: "staff", id: user.id, orgId: user.orgId }, "auth.sso_login", "user", user.id, { issuer: cfg.issuer, subject: identity.subject, provisioned: created });
    return to("/app");
  } catch (e) {
    await audit({ type: "system", orgId: st.orgId }, "auth.sso_failed", "sso_config", st.orgId, { reason: (e as Error).message.slice(0, 300) });
    if (!(e instanceof SsoError)) console.error("sso callback failed", e);
    return fail(st.test, e instanceof SsoError ? e.message : "Single sign-on failed. Please try again or contact your administrator.");
  }
}
