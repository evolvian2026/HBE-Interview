# AWS Lambda code executor

Runs candidates' code for HBE Interview's live-coding exercises (`CODE_EXECUTOR=aws-lambda`). Judge0 stays the default; switch when this is deployed and checked.

## What it is

- **Image** (`Dockerfile`): the AWS Lambda Node.js 22 base image plus Python 3, Java 21 (Corretto) and g++. The handler (`handler.ts`) is bundled with the app's own runner (`src/lib/exec/runner.ts`), so verdicts are identical to the local executor.
- **Isolation** (`template.yaml`): the function runs in a VPC with private subnets only — no internet gateway, no NAT, no VPC endpoints — and a security group with no usable egress, so candidate code has no network. Memory (default 1 GB), timeout (60 s for the whole batch, 3 s CPU per test), `/tmp` (1 GB) and reserved concurrency (default 20) are bounded. Each run uses a fresh temp directory and its own process group; after every invocation the handler kills any stray process and empties `/tmp`, so a warm environment can't carry anything from one candidate to the next.
- **Access**: the stack creates an IAM user whose only permission is `lambda:InvokeFunction` on this function. The web service signs requests itself (SigV4) — no AWS SDK.

## Deploy

```bash
# 1. Build and push the image (from the repository root)
aws ecr create-repository --repository-name hbe-executor
docker build -f infra/aws-executor/Dockerfile -t hbe-executor .
docker tag hbe-executor <account>.dkr.ecr.<region>.amazonaws.com/hbe-executor:1
aws ecr get-login-password | docker login --username AWS --password-stdin <account>.dkr.ecr.<region>.amazonaws.com
docker push <account>.dkr.ecr.<region>.amazonaws.com/hbe-executor:1

# 2. Deploy the stack
aws cloudformation deploy --stack-name hbe-executor --template-file infra/aws-executor/template.yaml \
  --capabilities CAPABILITY_IAM --parameter-overrides ImageUri=<account>.dkr.ecr.<region>.amazonaws.com/hbe-executor:1

# 3. Create an access key for the invoker user (stack output InvokerUserName)
aws iam create-access-key --user-name <InvokerUserName>
```

Set on the web service: `CODE_EXECUTOR=aws-lambda`, `AWS_REGION`, `AWS_LAMBDA_FUNCTION=hbe-executor`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`. Then verify:

```bash
CODE_EXECUTOR=aws-lambda AWS_REGION=… AWS_LAMBDA_FUNCTION=hbe-executor AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… npx tsx scripts/check-aws-executor.ts
```

## Local testing

The image includes the Lambda Runtime Interface Emulator:

```bash
docker run --rm -p 8080:8080 hbe-executor
AWS_LAMBDA_ENDPOINT=http://localhost:8080 AWS_LAMBDA_FUNCTION=function AWS_ACCESS_KEY_ID=x AWS_SECRET_ACCESS_KEY=x npx tsx scripts/check-aws-executor.ts
```

## Cost

Billed per GB-second: a 3-test JavaScript run takes ~0.2 s at 1 GB; compiled languages add compile time (~1–2 s for Java/C++). Reserved concurrency caps the worst case.
