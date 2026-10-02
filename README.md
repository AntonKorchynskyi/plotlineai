# plotlineai

Upload a CSV, let an AI agent suggest the best charts, and render them from the
real data.

## Stack

- `deploy/Caddyfile` - Caddy (`proxy` service): the local stack's only published port. It
  sets the client address that rate limiting keys on, and routes `/local-s3` to S3Mock.
- `frontend/` - Next.js 16 (`web` service): UI + AI orchestration. `proxy.ts` sets the
  per-request CSP and decides which api paths the browser may reach.
- `backend/` - Spring Boot 4.1 / Java 25 (`api` service): CSV parsing, storage, aggregation.
- Storage is DynamoDB and S3. Locally, DynamoDB Local (`dynamodb`) and S3Mock (`s3`) stand in
  for them, and `aws-init` creates the tables (`deploy/local/init-aws.sh`). No AWS account is
  needed to run or test anything.
- `infra/` - AWS CDK: the production stacks.
- `e2e/` - the Playwright suite, and `e2e/ai-stub`, a stand-in for the OpenAI API.

## Run locally

```bash
cp .env.example .env    # then edit values; OPENAI_API_KEY can stay blank for now
docker compose up --build
```

- App: http://localhost:3000
- Backend health: `docker compose exec api curl -s localhost:8081/actuator/health`

Only `proxy` is published. The other services sit on the internal network, and actuator
listens on a management port that no browser path reaches. Uploads go from the browser
straight to S3Mock through presigned URLs, as they go to S3 on AWS.

## Develop without Docker

Keep the storage stand-ins in Docker, published on localhost:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d dynamodb s3 aws-init
```

Then run the backend and the frontend on the host (Git Bash):

```bash
# backend, on localhost:8080
cd backend
PLOTLINEAI_DYNAMODB_ENDPOINT=http://localhost:8000 PLOTLINEAI_S3_ENDPOINT=http://localhost:9090 \
AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local ./mvnw spring-boot:run

# frontend, on localhost:3000 (a second terminal)
cd frontend && npm install
RATE_LIMIT_TABLE=plotlineai-rate-limits DYNAMODB_ENDPOINT=http://localhost:8000 \
UPLOAD_ORIGIN=http://localhost:9090 AWS_REGION=us-east-1 \
AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local npm run dev
```

Neither stand-in checks credentials, but the AWS SDKs want some. `UPLOAD_ORIGIN` lets the
page's CSP allow the browser's PUT to S3Mock. Add `OPENAI_API_KEY` to the frontend's
environment for AI suggestions.

## Tests

```bash
cd backend  && ./mvnw verify          # needs Docker (Testcontainers)
cd frontend && npm run lint && npm run typecheck && npm test && npm run build
cd infra    && npm run typecheck && npm test  # CDK assertions and cdk-nag
```

End to end, against the full stack with the AI stub in place of OpenAI:

```bash
docker compose -f docker-compose.yml -f docker-compose.e2e.yml up -d --build --wait
cd e2e && npm ci && npx playwright install chromium && npx playwright test
```

The rate-limit spec drains a bucket on purpose. It refills within a minute, so wait that
long before running the suite again on the same stack.

## Production (AWS)

The public deployment runs on AWS: CloudFront in front of two Lambda functions (web on
Node 24 through the Lambda Web Adapter, api on Java 25 with SnapStart), with DynamoDB and S3
for storage. Nothing runs while no one visits, so an idle month costs well under a dollar; a
$5 budget alert, reserved concurrency, the rate limits and the daily AI and upload caps bound
the rest. OpenAI usage is billed separately and capped by the daily call limit.

`infra/` defines three CDK stacks: `PlotlineData` (tables and the data bucket, retained on
delete), `PlotlineApp` (the functions, CloudFront, the budget) and `PlotlineCi` (the GitHub
OIDC role). After the one-time setup, every merge to `main` deploys through
`.github/workflows/deploy.yml` once the owner approves it.

The one-time setup, the smoke checklist, rollback and tear-down are in
[docs/deploy-aws.md](docs/deploy-aws.md).
