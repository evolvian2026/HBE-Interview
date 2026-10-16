import { createHmac } from "node:crypto";

/** Pure helpers for outbound webhooks (kept DB-free so they are unit-testable). */

/** Signature header value: `sha256=` + hex HMAC-SHA256 of `${timestamp}.${body}` (see docs/API.md). */
export function signPayload(secret: string, timestamp: string, body: string) {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

/** True for loopback, private, link-local, CGNAT, unique-local and metadata hosts/addresses (SSRF guard). */
export function isInternalHost(host: string) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|::1$|::$|f[cd][0-9a-f]{2}:|fe80:|::ffff:(127|10|192\.168|169\.254)\.|metadata\.google\.internal)/.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h) ||
    h.endsWith(".internal") ||
    h.endsWith(".local")
  );
}
