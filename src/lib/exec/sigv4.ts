import { createHash, createHmac } from "node:crypto";

/** Minimal AWS Signature Version 4 signer (header-based), enough for Lambda Invoke without the AWS SDK. */

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

const sha256hex = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

/** RFC 3986 encoding as AWS requires (encodeURIComponent leaves !'()* unescaped). */
export const awsEncode = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export function amzDate(d: Date) {
  return d.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

export function signRequest(req: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  region: string;
  service: string;
  credentials: AwsCredentials;
  now?: Date;
}): Record<string, string> {
  const url = new URL(req.url);
  const date = amzDate(req.now ?? new Date());
  const day = date.slice(0, 8);
  const headers: Record<string, string> = { ...(req.headers ?? {}), host: url.host, "x-amz-date": date };
  if (req.credentials.sessionToken) headers["x-amz-security-token"] = req.credentials.sessionToken;
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, " ")]));
  const names = Object.keys(lower).sort();
  const canonicalHeaders = names.map((n) => `${n}:${lower[n]}\n`).join("");
  const signedHeaders = names.join(";");
  // Non-S3 services: each path segment of the (already encoded) request path is encoded again.
  const canonicalUri = url.pathname.split("/").map(awsEncode).join("/") || "/";
  const canonicalQuery = [...url.searchParams.entries()]
    .map(([k, v]) => [awsEncode(k), awsEncode(v)] as const)
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonicalRequest = [req.method.toUpperCase(), canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, sha256hex(req.body ?? "")].join("\n");
  const scope = `${day}/${req.region}/${req.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", date, scope, sha256hex(canonicalRequest)].join("\n");
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${req.credentials.secretAccessKey}`, day), req.region), req.service), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${req.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
