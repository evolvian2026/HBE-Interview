import { describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { signRequest } from "@/lib/exec/sigv4";
import { validate } from "../infra/aws-executor/handler";
import { slugify } from "@/lib/core/slug";

// Official AWS SigV4 test-suite vectors (via smithy-lang/smithy-typescript, packages/signature-v4/src/suite.fixture.ts).
const creds = { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" };
const now = new Date("2015-08-30T12:36:00Z");
const sig = (h: Record<string, string>) => h.authorization.split("Signature=")[1];

describe("SigV4 signer", () => {
  it("matches the AWS test suite", () => {
    const base = { region: "us-east-1", service: "service", credentials: creds, now };
    expect(sig(signRequest({ ...base, method: "GET", url: "https://example.amazonaws.com/" }))).toBe("5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31");
    expect(sig(signRequest({ ...base, method: "GET", url: "https://example.amazonaws.com/?Param2=value2&Param1=value1" }))).toBe("b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500");
    expect(sig(signRequest({ ...base, method: "POST", url: "https://example.amazonaws.com/?Param1=value1" }))).toBe("28038455d6de14eafc1f9222cf5aa6f1a96197d7deb8263271d420d138af7f11");
    const form = signRequest({ ...base, method: "POST", url: "https://example.amazonaws.com/", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "Param1=value1" });
    expect(sig(form)).toBe("ff11897932ad3f4e8b18135d722051e5ac45fc38421b1da7b9d196a0fe09473a");
    expect(form.authorization).toContain("Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=content-type;host;x-amz-date,");
  });
  it("adds the session token as a signed header", () => {
    const h = signRequest({ method: "POST", url: "https://lambda.ap-south-1.amazonaws.com/x", region: "ap-south-1", service: "lambda", credentials: { ...creds, sessionToken: "tok" }, now });
    expect(h["x-amz-security-token"]).toBe("tok");
    expect(h.authorization).toContain("SignedHeaders=host;x-amz-date;x-amz-security-token");
  });
});

describe("AWS Lambda executor client", () => {
  it("sends a signed Invoke request and maps results; function errors become 'unavailable'", async () => {
    const seen: { path?: string; auth?: string; body?: Record<string, unknown> } = {};
    let fail = false;
    const server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        seen.path = req.url;
        seen.auth = String(req.headers.authorization);
        seen.body = JSON.parse(raw);
        if (fail) {
          res.writeHead(200, { "content-type": "application/json", "x-amz-function-error": "Unhandled" });
          return res.end(JSON.stringify({ errorMessage: "boom" }));
        }
        const tests = (seen.body?.tests ?? []) as { output: string }[];
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ results: tests.map((t, i) => ({ verdict: i === 0 ? "AC" : "WA", stdout: i === 0 ? t.output : "nope", stderr: "", timeMs: 5 })) }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    Object.assign(process.env, {
      CODE_EXECUTOR: "aws-lambda",
      AWS_LAMBDA_ENDPOINT: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      AWS_LAMBDA_FUNCTION: "arn:aws:lambda:ap-south-1:123456789012:function:hbe-executor",
      AWS_ACCESS_KEY_ID: "AKIDTEST",
      AWS_SECRET_ACCESS_KEY: "secret",
      AWS_REGION: "ap-south-1",
    });
    const { executeTests } = await import("@/lib/exec");
    const r = await executeTests("python", "print(1)", [{ input: "", output: "1" }, { input: "", output: "2" }], { revealIO: true });
    expect(r.passed).toBe(1);
    expect(r.total).toBe(2);
    expect(seen.path).toBe("/2015-03-31/functions/arn%3Aaws%3Alambda%3Aap-south-1%3A123456789012%3Afunction%3Ahbe-executor/invocations");
    expect(seen.auth).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDTEST\/\d{8}\/ap-south-1\/lambda\/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-invocation-type, Signature=[0-9a-f]{64}$/);
    expect(seen.body).toMatchObject({ language: "python", code: "print(1)", cpuSec: 3 });
    fail = true;
    const down = await executeTests("python", "print(1)", [{ input: "", output: "1" }], { revealIO: false });
    expect(down.unavailable).toBeTruthy();
    server.close();
  });
});

describe("Lambda handler validation", () => {
  const ok = { language: "javascript", code: "console.log(1)", tests: [{ input: "", output: "1" }] };
  it("accepts a well-formed request and clamps the CPU limit", () => {
    expect(validate({ ...ok, cpuSec: 99 }).cpuSec).toBe(5);
    expect(validate(ok).cpuSec).toBe(3);
  });
  it("rejects bad payloads", () => {
    expect(() => validate(null)).toThrow();
    expect(() => validate({ ...ok, language: "cobol" })).toThrow("Unsupported language");
    expect(() => validate({ ...ok, code: "x".repeat(70_000) })).toThrow();
    expect(() => validate({ ...ok, tests: [] })).toThrow();
    expect(() => validate({ ...ok, tests: Array.from({ length: 51 }, () => ({ input: "", output: "" })) })).toThrow();
    expect(() => validate({ ...ok, tests: [{ input: 1, output: "" }] })).toThrow("Invalid test case");
  });
});

describe("tenancy helpers", () => {
  it("slugifies organisation names", () => {
    expect(slugify("Acme Robotics Pvt. Ltd.")).toBe("acme-robotics-pvt-ltd");
    expect(slugify("  Café Ünïcode  ")).toBe("cafe-unicode");
  });
});

describe("HR knowledge base retrieval helpers", () => {
  it("chunks long documents at paragraph boundaries without losing text", async () => {
    const { chunkText } = await import("@/lib/core/kb");
    const paras = Array.from({ length: 30 }, (_, i) => `Policy ${i}: ` + "Employees accrue leave monthly. ".repeat(8));
    const chunks = chunkText(paras.join("\n\n"));
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => c.length <= 1800)).toBe(true);
    expect(chunks.join("\n\n").replace(/\s+/g, " ")).toBe(paras.join(" ").replace(/\s+/g, " ").trim());
    const huge = chunkText("x".repeat(5000));
    expect(huge.every((c) => c.length <= 1800) && huge.join("").length === 5000).toBe(true);
    expect(chunkText("   ")).toEqual([]);
  });
  it("builds an OR prefix query from a question, dropping stop words, in any script", async () => {
    const { ftsQuery } = await import("@/lib/core/kb");
    expect(ftsQuery("What is the notice period after probation?")).toBe("notice:* | period:* | after:* | probation:*");
    expect(ftsQuery("छुट्टी नीति क्या है")).toContain("छुट्टी:*");
    expect(ftsQuery("is it ok?")).toBeNull();
    expect(ftsQuery("a'); drop table x; --")).toBe("drop:* | table:*");
  });
});
