# Deploying to AWS

PlotlineAI runs on AWS as two Lambda functions behind CloudFront, with DynamoDB and S3 for
storage, an event pipeline that archives anonymous usage events and emails alerts, and a
Redshift Serverless warehouse the archive is loaded into every Monday. There is no server,
container cluster or database instance to run, so an idle month costs well under a dollar.
Everything is defined in code in `infra/` (AWS CDK) and deployed from GitHub Actions whenever
CI passes on `main`.

This page is the one-time setup, then the smoke checklist, then operations. Run the commands
in **Git Bash** from the repository root.

## How it fits together

```
browser -> CloudFront -+-> S3 "assets" bucket    (/_next/static/*: JavaScript, CSS)
                       +-> web function URL      (everything else)
                              |  SigV4-signed requests
                              v
                           api function URL -> DynamoDB "plotlineai-app", S3 "data" bucket
browser -- presigned PUT --> S3 "data" bucket (uploads/)

web, api --usage events--> EventBridge bus "plotlineai"
   +-- every event --> SQS "analytics-events" --> event-archiver --> S3 "analytics" bucket
   |                     (5 failures: SQS "analytics-events-dlq")
   +-- quota.exhausted --> SNS "plotlineai-alerts" --> email
CloudWatch alarms ------> SNS "plotlineai-alerts" --> email

EventBridge Scheduler (Mondays 06:00 UTC) --> redshift-loader --Data API--> Redshift Serverless
                                       (COPY the past week's files from the "analytics" bucket)
```

What each piece is, in plain words:

- **CloudFront:** the front door. Every visitor's browser talks only to CloudFront, a global
  network of servers. It serves the static files from a copy near the visitor, adds HTTPS
  and HSTS, and forwards page and API requests to the `web` function. It is the only part of
  the app the internet can use. A tiny CloudFront Function passes the address the browser
  used (`X-Forwarded-Host`) on to web, which checks it against the `Origin` of every write.
- **Lambda:** runs our code without a server we manage. AWS starts a copy of a function when
  a request arrives and stops it when idle; we pay per request and per millisecond.
  - `plotlineai-web` runs Next.js (pages, AI calls, security checks, rate limits) through
    the Lambda Web Adapter, which lets the normal Next.js server run inside Lambda.
  - `plotlineai-api` runs Spring Boot (CSV parsing, chart data).
- **SnapStart:** AWS starts the api once at deploy time, snapshots the ready-to-go Java app,
  and resumes new copies from that snapshot instead of booting Java from scratch.
- **Function URL:** a Lambda function's own HTTPS address.
  - web's URL is public, but web refuses any request without the secret `X-Origin-Verify`
    header that only CloudFront adds.
  - api's URL only accepts requests signed with web's AWS identity, so nothing else can call
    it.
- **IAM:** the permission system. Each function has its own role listing exactly what it may
  touch, such as "read and write this one table".
- **DynamoDB:** a serverless key-value database billed per request. `plotlineai-app` holds
  datasets, shares and the daily counters; `plotlineai-rate-limits` holds the rate-limit
  windows. TTL deletes items automatically once they expire.
- **S3:** file storage. The `data` bucket holds uploaded CSVs and parsed rows, deleted after
  one or two days by lifecycle rules. The `assets` bucket holds the site's static files. A
  **presigned URL** is a temporary permission slip ("upload one file of exactly this size to
  this path within 5 minutes"), so the browser uploads straight to S3 without AWS
  credentials.
- **SSM Parameter Store / Secrets Manager:** encrypted storage for secrets, read by web when
  it starts. The OpenAI key is in Parameter Store (free); the CloudFront header value is in
  Secrets Manager.
- **EventBridge:** an event router. web and api publish a small event for each upload,
  render, share and AI call, and when a daily quota runs out (the full list is
  `infra/events/schema.md`). Events carry counts and timings, never an IP, a file name or
  any of the data. Rules on the bus decide where each event goes.
- **SQS:** a queue that holds events until the archiver takes them, so a burst or an archiver
  failure loses nothing. A message that fails 5 times moves to the **dead-letter queue**
  (DLQ), where it waits 14 days for a look.
- **`plotlineai-event-archiver`:** a small Lambda function that drains the queue in batches
  of up to 100 (or every minute) and writes each batch to the `analytics` bucket as one
  compressed file per day, `events/dt=YYYY-MM-DD/<id>.json.gz`.
- **Redshift Serverless:** a SQL data warehouse, built for questions over many rows ("renders
  per chart type this month"). Serverless means no cluster to size: it starts when a query
  arrives, bills per second while queries run (at least 60 s each time), and pauses when
  idle. Capacity is measured in **RPUs** (Redshift Processing Units); ours uses the minimum,
  4 RPU, at about $0.375 per RPU-hour. A **usage limit** turns it off for the rest of the
  month after 20 RPU-hours (about $7.50), so it cannot run away. It holds the table
  `public.events` and the views in `infra/analytics/02-views.sql`, in the database
  `analytics`.
  - It has to live in a **VPC** (a private network). Ours has three subnets and nothing else:
    no internet access in or out, and a firewall (security group) that lets nothing in.
  - The **namespace** holds the data; the **workgroup** is the compute that runs queries.
  - There is no admin password. The loader signs in as its IAM role (database user
    `IAMR:plotlineai-redshift-loader`, which owns the table and views), and you sign in as
    your own IAM user, which may read them.
- **EventBridge Scheduler:** runs a task on a timetable. Every Monday at 06:00 UTC it starts
  `plotlineai-redshift-loader`, which loads the past 7 days' archive files into Redshift in
  one go (each start of Redshift bills at least 60 seconds, so once a week is cheapest, and a
  week with no visitors does not start Redshift at all) through
  the **Redshift Data API** (SQL over HTTPS, no database connection to manage). A load
  replaces the whole day, so running it twice gives the same result.
- **SNS:** sends notifications. The `plotlineai-alerts` topic emails your alert address.
- **CloudWatch alarms:** watch a metric and email through SNS when it crosses a line, then
  again when it recovers: api or web failing 5+ times in 5 minutes, any function throttled,
  more than 5% CloudFront server errors over 15 minutes, the archiver failing, anything in
  the DLQ, or the weekly Redshift load failing.
- **CloudWatch Logs:** the functions' logs, kept 14 days.
- **AWS Budgets:** emails you when the month's bill heads past $5.
- **CDK and CloudFormation:** CDK turns the TypeScript in `infra/` into CloudFormation
  templates, and CloudFormation creates or updates the resources to match. A **stack** is a
  group of resources managed together:
  - `PlotlineData`: the tables, the data bucket and the analytics bucket (events are kept
    400 days). Termination protection is on, and every resource is kept even if the stack
    is deleted.
  - `PlotlinePipeline`: the event bus, its rules, the queues, the archiver, the alerts topic
    and the alarms on those.
  - `PlotlineApp`: the functions, CloudFront, the assets bucket, the secret, the budget, and
    the alarms on the functions and CloudFront.
  - `PlotlineAnalytics`: Redshift Serverless (namespace, workgroup, usage limit), its VPC,
    the loader, its schedule and its alarm. Everything in Redshift can be rebuilt from the
    archive, so deleting this stack loses nothing for good.
  - `PlotlineCi`: the GitHub OIDC trust and the deploy role (deployed once, by hand).
- **GitHub OIDC:** lets the deploy job prove to AWS that it is this repository's
  `production` job and receive one-hour credentials. No AWS key is stored in GitHub.

## What it costs, and what stops it costing more

| Item | Monthly |
|---|---|
| Lambda (web, api, archiver, loader) | $0 (inside the always-free allowance at portfolio traffic) |
| DynamoDB on-demand, point-in-time recovery on `plotlineai-app` | about $0-0.05 |
| S3 (data, assets, CDK's asset bucket) | about $0.05-0.20 |
| CloudFront, and its CloudFront Function | $0 (always-free) |
| Secrets Manager (the origin-verify secret) | $0.40 |
| SSM Parameter Store standard | $0 |
| CloudWatch Logs, 14-day retention | $0 (5 GB always-free) |
| EventBridge, SQS, SNS email, Scheduler | $0 (always-free) |
| CloudWatch alarms (7) | $0 (10 always-free) |
| Event archive in S3 | well under $0.01 |
| Redshift Serverless: the weekly load (60 s minimum at 4 RPU, about $0.025 each; none in a week without visitors) | about $0.10 |
| Redshift Serverless: your own queries (about $0.025 per minute of querying) | $0-1 |
| **Total** | **about $0.50-1** |

OpenAI usage is billed by OpenAI, not AWS.

AWS has no hard spending cap, so the setup stacks limits instead:
- the account's Lambda concurrency limit: at most 10 copies of the two functions run at
  once (step 1.4);
- the rate limits per client and overall (DynamoDB windows of 60 s);
- the AI daily call limit (`AI_DAILY_CALL_LIMIT=500`) and the upload daily quota
  (`UPLOAD_DAILY_LIMIT=300`);
- the Redshift usage limit: 20 RPU-hours a month (about $7.50), after which Redshift is
  switched off until the next month;
- the $5 AWS Budgets alert;
- a monthly limit on the OpenAI project (set it in the OpenAI dashboard, under **Limits**).

Deliberately avoided: NAT gateways, load balancers, API Gateway, RDS, WAF and customer-managed
KMS keys. cdk-nag, which checks the stacks on every synth, lists each such trade-off with its
reason in `infra/lib/*-stack.ts`.

## One-time setup

### 1. Budget, admin access and the AWS CLI

1. In the AWS console, **Billing and Cost Management > Budgets**: the `PlotlineApp` stack
   creates the $5 budget itself, but if the account has none yet, create a $5 monthly cost
   budget now so the setup is covered too.
2. Use an IAM Identity Center user or an IAM user with administrator access, never the root
   user, for the steps below.
3. Install the AWS CLI v2 (<https://aws.amazon.com/cli/>), then sign in (`aws configure sso`
   or `aws configure`) and check which account you are in:

   ```bash
   aws sts get-caller-identity
   ```

   **What this does:** prints the account number and user the CLI acts as. Read-only, free.

4. Check the account's Lambda concurrency quota:

   ```bash
   aws lambda get-account-settings --region us-east-1 --query AccountLimit.ConcurrentExecutions
   ```

   **What this does:** reads how many function copies may run at once in this account. New
   accounts start at 10, which is plenty for a handful of visitors at a time and doubles as
   the hard cap on both functions together. By default the stacks reserve nothing per
   function. To cap each function separately (say `-c reservedConcurrency=20`), first raise
   the limit to at least 100 under **Service Quotas > AWS Lambda > Concurrent executions**:
   AWS refuses reservations that leave fewer than 10 copies unreserved.

### 2. Bootstrap CDK

```bash
cd infra && npm ci
npx cdk bootstrap aws://<account-id>/us-east-1
```

**What this does:** creates CDK's helper stack `CDKToolkit` in the account: an S3 bucket and
an ECR repository for uploading function code, and the five IAM roles CDK deploys through.
Cost is about $0 (a few MB in S3). Undo: empty its bucket, then delete the `CDKToolkit`
stack in CloudFormation.

### 3. The CI stack

```bash
npx cdk deploy PlotlineCi -c alertEmail=<your email>
```

**What this does:** creates the GitHub OIDC provider and the `plotlineai-deploy` role. The
role trusts only jobs in this repository's `production` environment, and its only permission
is to hand the deployment to CDK's bootstrap roles. Free. Undo: `npx cdk destroy PlotlineCi`.
The role's ARN is `arn:aws:iam::<account-id>:role/plotlineai-deploy`; step 5 needs it.

The trust matches GitHub's immutable subject format, which names the owner's and the
repository's numeric IDs (`bin/plotlineai.ts`). If the deploy job fails with "Not authorized
to perform sts:AssumeRoleWithWebIdentity", compare the format with
`gh api repos/<owner>/<repo>/actions/oidc/customization/sub`.

(`alertEmail` is required by every CDK command in this app; it is only used by `PlotlineApp`.)

### 4. The OpenAI key

Create the parameter yourself; the key never goes into the repository, CDK or GitHub:

```bash
aws ssm put-parameter --region us-east-1 --name /plotlineai/openai-api-key \
  --type SecureString --value '<your key>'
```

**What this does:** stores the key encrypted with the AWS-managed SSM key. Free (standard
parameter). Web reads it when it starts. To rotate it, rerun with `--overwrite`; web picks
it up on its next cold start.

### 5. The GitHub `production` environment

In the repository, **Settings > Environments > New environment**, name it `production`:
- **Required reviewers:** none. Every push to `main` whose CI run passes deploys on its own;
  a failing check (tests, lint, e2e, scans, synth) stops it. Add yourself here to approve
  each deploy by hand instead.
- **Deployment branches and tags:** selected branches, `main`. The deploy role trusts only
  this environment, so nothing but `main` can deploy.
- **Environment variables:** `AWS_DEPLOY_ROLE_ARN` (the role ARN from step 3) and
  `ALERT_EMAIL` (where the budget alert goes).

### 6. The first deploy

`.github/workflows/deploy.yml` only runs once it is on `main`, so the first deploy runs from
your machine. Build both functions' code first. The web bundle must be built on Linux
x86_64, the platform Lambda runs, because Next's output includes native binaries for the
platform that built it; Docker does that on Windows:

```bash
(cd backend && ./mvnw -B package -DskipTests)
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W)/frontend:/app" -w /app node:24 \
  sh -c "npm ci && npm run build && npm run build:lambda"
cd infra
npm ci && npm run build:lambda
npx cdk diff PlotlineData PlotlinePipeline PlotlineApp PlotlineAnalytics -c alertEmail=<your email>
npx cdk deploy PlotlineData PlotlinePipeline PlotlineApp PlotlineAnalytics -c alertEmail=<your email>
```

The container's `npm ci` replaces `frontend/node_modules` with Linux builds; run `npm ci` in
`frontend/` again afterwards for local work.

**What this does:** `diff` lists every resource that would be created, without changing
anything. `deploy` creates the stacks (about 5-10 minutes, mostly CloudFront) and prints
`PlotlineApp.SiteUrl`, the `https://<id>.cloudfront.net` address of the site.

SNS then emails the alert address "AWS Notification - Subscription Confirmation". Click
**Confirm subscription** in it, or no alert will ever arrive.

After that, every merge to `main` deploys through GitHub: CI passes and `Deploy` runs on its
own. A manual deploy of `main` is **Actions > Deploy > Run workflow**.

## Smoke checklist

Run after the first deploy and after any infrastructure change. `SITE` is the `SiteUrl`.

1. **Pages and assets.** The landing page and gallery load. Static files come from
   CloudFront's cache:

   ```bash
   curl -sI "$SITE/" | grep -i strict-transport-security
   curl -sI "$SITE$(curl -s "$SITE/" | grep -o '/_next/static/[^"]*\.js' | head -1)" | grep -i x-cache
   ```

   Expected: an HSTS header, then `x-cache: Hit from cloudfront` (on the second request).
2. **The user flow.** Upload `revenue-by-region.csv`, pick a suggestion, refine it, share it,
   and open the share link in a private window.
3. **A PUT that does not match the presign is refused by S3:**

   ```bash
   curl -s -X POST "$SITE/api/backend/datasets/uploads" -H "Origin: $SITE" \
     -H "Content-Type: application/json" \
     -d '{"filename":"a.csv","contentType":"text/csv","size":10}'
   # take "url" from the answer, then send 11 bytes instead of 10:
   curl -s -o /dev/null -w '%{http_code}\n' -X PUT "<url>" -H "Content-Type: text/csv" \
     --data-binary 'a,b\n1,2,3,4'
   ```

   Expected: `403` (the signed `Content-Length` does not match).
4. **The functions cannot be reached around CloudFront:**

   ```bash
   aws lambda get-function-url-config --region us-east-1 --function-name plotlineai-web --query FunctionUrl
   aws lambda get-function-url-config --region us-east-1 --function-name plotlineai-api --qualifier live --query FunctionUrl
   curl -s -o /dev/null -w '%{http_code}\n' "<web url>"        # 403: no X-Origin-Verify
   curl -s -o /dev/null -w '%{http_code}\n' "<api url>gallery" # 403: not signed
   ```

5. **Forged client addresses do not dodge the rate limit.** Send the same request with
   different `X-Forwarded-For` and `CloudFront-Viewer-Address` values until it answers 429;
   the forged values must not reset the count:

   ```bash
   for i in $(seq 1 12); do
     curl -s -o /dev/null -w '%{http_code} ' -X POST "$SITE/api/suggest" -H "Origin: $SITE" \
       -H "Content-Type: application/json" -H "X-Forwarded-For: 10.0.0.$i" \
       -H "CloudFront-Viewer-Address: 10.0.0.$i:443" -d '{}'
   done; echo
   ```

   Expected: `400` answers (the body is invalid), then `429` once the client limit of 10 is
   reached.
6. **Internal routes are hidden:** `curl -s -o /dev/null -w '%{http_code}\n' -X POST
   "$SITE/api/backend/internal/ai-budget/consume"` answers `404`.
7. **Cold starts.** After 15 idle minutes, time the first request to the landing page
   (web and api both start). Look up each function's `Init Duration` (web) and
   `Restore Duration` (api, SnapStart) in its logs:

   ```bash
   aws logs tail /aws/lambda/plotlineai-web --region us-east-1 --since 20m | grep -i duration
   aws logs tail /aws/lambda/plotlineai-api --region us-east-1 --since 20m | grep -i duration
   ```

   Record them below.

**Measured cold starts** (2026-10-02, landing page after 16 idle minutes, both functions cold):

| | Cold | Warm |
|---|---|---|
| Landing page, time to first byte at the browser | 4.1 s | 0.25 s |
| web: `Init Duration` (Node and the Web Adapter start) | 0.54 s | - |
| web: first request (loads the secrets and Next's server code, renders the page) | 2.7 s | 0.06-0.12 s |
| api: `Restore Duration` (SnapStart resumes the snapshot) | 0.67 s | - |
| api: first request (`/gallery`) | 0.16 s | 0.006 s |

The api waits inside web's first request, so the cold total is mostly web's first render.

8. **Events and alerts.**
   - Upload a CSV and render a chart on the site. Within about two minutes (the archiver
     waits up to a minute to fill a batch) a file appears in the archive; read it:

     ```bash
     BUCKET=$(aws cloudformation describe-stack-resources --region us-east-1 \
       --stack-name PlotlineData --logical-resource-id AnalyticsBucket39EAAEEA \
       --query 'StackResources[0].PhysicalResourceId' --output text)
     aws s3 ls "s3://$BUCKET/events/" --recursive | tail -3
     aws s3 cp "s3://$BUCKET/<key from above>" - | gunzip
     ```

     Expected: one JSON line per event (`dataset.uploaded`, `chart.rendered`, ...) with
     counts and timings only.
   - A quota alert: put a sample `quota.exhausted` event on the bus. The alert address gets
     the readable quota email within a minute:

     ```bash
     cat > quota-event.json <<'JSON'
     [{"EventBusName": "plotlineai", "Source": "plotlineai.api", "DetailType": "quota.exhausted",
       "Detail": "{\"version\":1,\"occurredAt\":\"2026-01-01T00:00:00Z\",\"requestId\":\"smoke\",\"quota\":\"ai\",\"limit\":500,\"day\":\"smoke-test\"}"}]
     JSON
     aws events put-events --region us-east-1 --entries file://quota-event.json
     rm quota-event.json
     ```

   - The DLQ alarm: send one message to the DLQ and wait for the "ALARM" email (up to 10
     minutes), then purge the queue and wait for the "OK" email:

     ```bash
     DLQ=$(aws sqs get-queue-url --region us-east-1 --queue-name analytics-events-dlq \
       --query QueueUrl --output text)
     aws sqs send-message --region us-east-1 --queue-url "$DLQ" --message-body smoke-test
     aws sqs purge-queue --region us-east-1 --queue-url "$DLQ"
     ```

9. **Analytics.** Use the site a little (step 2), wait two minutes for the archive, then
   load today by hand (the schedule only loads past days):

   ```bash
   aws lambda invoke --region us-east-1 --function-name plotlineai-redshift-loader \
     --cli-binary-format raw-in-base64-out --payload "{\"day\":\"$(date -u +%F)\"}" \
     --cli-read-timeout 310 load.json && cat load.json && rm load.json
   ```

   **What this does:** runs one load. The first one takes a minute or two while Redshift
   wakes up. Expected: `{"days":["<today>"],"loaded":["<today>"],"rows":<more than 0>}`.
   Run it again: the same number of rows (a load replaces the day). An error answer prints Redshift's message, and
   `aws logs tail /aws/lambda/plotlineai-redshift-loader --region us-east-1 --since 10m`
   has the details.

   Then query it: in the AWS console, **Amazon Redshift > Query editor v2**, open
   **Serverless: plotlineai**, choose **Federated user** (your own IAM sign-in), database
   `analytics`, and run:

   ```sql
   SELECT * FROM daily_activity ORDER BY day DESC;
   SELECT * FROM chart_type_mix ORDER BY renders DESC;
   SELECT * FROM ai_cost_daily ORDER BY day DESC;
   SELECT * FROM render_latency_p95 ORDER BY day DESC;
   ```

   Expected: today's uploads, renders, shares and AI calls match what you did. The loader
   alarm: invoke the loader with `{"day":"not-a-day"}` and wait for the
   `plotlineai-redshift-loader-errors` "ALARM" email, then the "OK" one about 15 minutes
   later.

## Operations

- **Logs:** `aws logs tail /aws/lambda/plotlineai-web --region us-east-1 --follow` (or
  `plotlineai-api`), or CloudWatch in the console.
- **Alerts:** every alert email names its alarm, and its description says what crossed the
  line; the function's logs say why. Each alarm emails again when it clears.
- **A DLQ alarm:** events the archiver gave up on are in `analytics-events-dlq`. Look at one
  (`aws sqs receive-message --queue-url <dlq url>`), fix the cause, then send them back with
  **SQS > analytics-events-dlq > Start DLQ redrive** in the console. The archiver files them
  under the day they happened, so if Redshift already loaded that week, load it again
  (below).
- **A failed weekly load:** the loader alarm emails you when an attempt fails, and Lambda
  tries twice more over the next few minutes. The logs say why, and an `analytics_load_done`
  line after the error means a retry loaded the week
  (`aws logs tail /aws/lambda/plotlineai-redshift-loader --region us-east-1 --since 1d`).
  If every attempt failed, fix the cause, then load that week again (below). A failed load
  changes nothing, because each load is one transaction.
- **Loading a past week again, or backfilling:** invoke the loader with the time of the
  Monday run that covers the week; it loads the 7 days before that time in one go, starting
  Redshift once. Days are independent, so the order does not matter. The archive goes back
  400 days. For example, to load 2026-09-28 to 2026-10-11:

  ```bash
  for monday in 2026-10-05 2026-10-12; do
    aws lambda invoke --region us-east-1 --function-name plotlineai-redshift-loader \
      --cli-binary-format raw-in-base64-out --payload "{\"scheduledTime\":\"${monday}T06:00:00Z\"}" \
      --cli-read-timeout 310 load.json && cat load.json && echo
  done; rm -f load.json
  ```

  `{"day":"YYYY-MM-DD"}` loads a single day (smoke step 9).
- **Redshift was switched off by the usage limit:** it comes back on the 1st of the month.
  To bring it back sooner, raise `MONTHLY_RPU_HOURS` in `infra/lib/analytics-stack.ts` and
  merge, then load the missed weeks (above). **Redshift Serverless > Workgroup plotlineai >
  Limits** shows the usage so far.
- **Changing the views:** edit `infra/analytics/02-views.sql` and merge; the next load
  applies it (the views are dropped and created again on every load). Give your own tables
  and views in Query Editor v2 other names than these, and create a view of yours that reads
  these `WITH NO SCHEMA BINDING`, or the next load drops it.
- **Changing the events table:** `CREATE TABLE IF NOT EXISTS` leaves the existing table as
  it is, and only the loader's database user may alter it, so a new column takes a new
  table name. In `infra/analytics/01-schema.sql`, create `public.events_v2` with the new
  columns, followed by `DROP TABLE IF EXISTS public.events CASCADE;`, then rename
  `public.events` to `public.events_v2` everywhere else it appears (`git grep -w
  public.events`: the views, the loader and their tests), merge, and backfill the archive
  (above).
- **Changing a limit:** the api's limits are environment variables in
  `infra/lib/app-stack.ts`; change them there and merge.
- **Rotating the CloudFront header secret:** in Secrets Manager, set a new value for the
  `OriginVerify` secret, then redeploy (`Deploy > Run workflow`), which hands the new value
  to CloudFront. Web reads it on its next cold start, so expect some 403s for a few minutes.

## Rollback

- **Normal path:** revert the change on `main` (`git revert`, PR, merge). The deploy that
  follows puts the previous code back.
- **The api, immediately:** point the `live` alias back at the previous published version.
  List the versions, then move the alias:

  ```bash
  aws lambda list-versions-by-function --region us-east-1 --function-name plotlineai-api --query 'Versions[].Version'
  aws lambda update-alias --region us-east-1 --function-name plotlineai-api --name live --function-version <previous>
  ```

  The next deploy moves `live` forward again.

## Tear-down

1. `npx cdk destroy PlotlineAnalytics -c alertEmail=<email>` removes Redshift (with its
   data, which the archive can rebuild), the VPC, the loader and its schedule. Then
   `npx cdk destroy PlotlineApp -c alertEmail=<email>` removes the functions, CloudFront,
   the secret, the budget and the logs. The `assets` bucket is kept (it is retained on
   purpose); empty and delete it in S3. Then `npx cdk destroy PlotlinePipeline -c
   alertEmail=<email>` removes the bus, the queues, the archiver and the alerts.
2. `PlotlineData` has termination protection, and its tables and bucket are retained. To
   delete the data for good: turn termination protection off in CloudFormation, delete the
   stack, then delete the `plotlineai-app` and `plotlineai-rate-limits` tables in DynamoDB
   and empty and delete the data and analytics buckets in S3.
3. `npx cdk destroy PlotlineCi -c alertEmail=<email>` removes the GitHub trust.
4. Delete the SSM parameter `/plotlineai/openai-api-key`, and, if nothing else uses CDK in
   this account and region, the `CDKToolkit` stack and its bucket.
