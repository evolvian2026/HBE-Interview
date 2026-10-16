# HBE Interview code executor — AWS Lambda container image (Python 3, Node.js 22, Java 21, g++).
# Build from the repository root:
#   docker build -f infra/aws-executor/Dockerfile -t hbe-executor .
# BASE can point at the Docker Hub mirror of the same image (amazon/aws-lambda-nodejs:22) if ECR Public is unreachable.
ARG BASE=public.ecr.aws/lambda/nodejs:22

FROM ${BASE} AS build
WORKDIR /build
COPY src/lib/exec/runner.ts src/lib/exec/runner.ts
COPY infra/aws-executor/handler.ts infra/aws-executor/handler.ts
RUN npx --yes esbuild@0.25.10 infra/aws-executor/handler.ts --bundle --platform=node --target=node22 --format=cjs --outfile=/build/index.js

FROM ${BASE}
RUN dnf install -y python3 java-21-amazon-corretto-devel gcc-c++ && dnf clean all && rm -rf /var/cache/dnf
COPY --from=build /build/index.js ${LAMBDA_TASK_ROOT}/index.js
CMD ["index.handler"]
