import { env } from "../env";
import { signRequest } from "./sigv4";
import type { Language, TestCase, TestResult } from "./runner";

/** Payload the HBE executor Lambda accepts (see infra/aws-executor/handler.ts). */
export interface LambdaRunRequest {
  language: Language;
  code: string;
  tests: TestCase[];
  cpuSec: number;
}

export interface LambdaRunResponse {
  results: TestResult[];
}

/** Run tests in the AWS Lambda executor via the Invoke API (SigV4-signed; no AWS SDK). */
export async function runAwsLambda(language: Language, code: string, tests: TestCase[], cpuSec: number): Promise<TestResult[]> {
  const fn = env.awsLambdaFunction;
  if (!fn || !env.aws.accessKeyId || !env.aws.secretAccessKey) throw new Error("AWS Lambda executor is not configured (AWS_LAMBDA_FUNCTION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)");
  if (!/^[A-Za-z0-9_:.-]+$/.test(fn)) throw new Error("AWS_LAMBDA_FUNCTION must be a function name or ARN");
  const base = (env.awsLambdaEndpoint || `https://lambda.${env.aws.region}.amazonaws.com`).replace(/\/$/, "");
  const url = `${base}/2015-03-31/functions/${encodeURIComponent(fn)}/invocations`;
  const body = JSON.stringify({ language, code, tests, cpuSec } satisfies LambdaRunRequest);
  const headers = signRequest({
    method: "POST",
    url,
    headers: { "content-type": "application/json", "x-amz-invocation-type": "RequestResponse" },
    body,
    region: env.aws.region,
    service: "lambda",
    credentials: { accessKeyId: env.aws.accessKeyId, secretAccessKey: env.aws.secretAccessKey, sessionToken: env.aws.sessionToken },
  });
  delete headers.host; // fetch sets Host itself
  const res = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(60_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`Lambda invoke failed: ${res.status} ${text.slice(0, 300)}`);
  const fnError = res.headers.get("x-amz-function-error");
  if (fnError) throw new Error(`Lambda function error (${fnError}): ${text.slice(0, 300)}`);
  const out = JSON.parse(text) as LambdaRunResponse;
  if (!Array.isArray(out.results) || out.results.length !== tests.length) throw new Error("Lambda executor returned an unexpected payload");
  return out.results;
}
