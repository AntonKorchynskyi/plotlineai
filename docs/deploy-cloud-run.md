# Deploying to Google Cloud Run

PlotlineAI runs publicly as one Cloud Run service in `us-east4`. `web` is the container that
receives traffic, and `api` runs beside it as a sidecar on `localhost:8080`. The database is
a free Neon Postgres in `aws-us-east-1`, a few milliseconds away. At portfolio traffic this
fits inside the free allowances, so the only running cost is OpenAI usage, which is capped.

This page is the one-time setup, then the routine deploy, then operations. Run the commands
in **Git Bash** from the repository root.

## What it costs, and what stops it costing more

| Piece | Free allowance (monthly) | Our use |
|---|---|---|
| Cloud Run | 2M requests, 180,000 vCPU-s, 360,000 GiB-s | 2 vCPU / 1.5 GiB while requests run; zero when idle |
| Artifact Registry | 0.5 GB | two images, 3 versions kept |
| Secret Manager | 6 secret versions, 10,000 reads | 4 secrets |
| Neon | 0.5 GB, 100 CU-hours | datasets capped at 300 MB, 0.25 CU, sleeps after 5 idle minutes |
| Egress from us-east4 | 1 GB | roughly a few thousand visits; about $0.12/GB beyond |

Google Cloud has no hard spending cap, so the setup stacks limits instead:
- `maxScale: 1` in `deploy/cloudrun/service.yaml`;
- the AI daily call limit (`AI_DAILY_CALL_LIMIT`, kept in Postgres);
- the rate limits;
- the dataset storage guard;
- a $5 budget alert;
- an OpenAI monthly limit.

**Keep `maxScale` at 1.** The rate limiters live in `web`'s memory, and they are only correct
for a single instance.

**The trade-off:** after about 15 idle minutes the service scales to zero, and the next
visitor waits while both containers start and Neon wakes up.

## One-time setup

### 1. Google Cloud account, project and budget

1. Sign up at <https://cloud.google.com/free>. New accounts get a 90-day, $300 trial. Always
   Free allowances continue after it, but only on a paid account. Before day 90, click
   **Upgrade** in the console, or the account closes and the service stops.
2. Create a project (Console, project picker, **New project**). Note its **project ID**,
   e.g. `plotlineai-123456`.
3. **Billing > Budgets & alerts > Create budget**: scope it to the project, set the amount
   to $5, and set alert thresholds at 50%, 90% and 100%.

### 2. The gcloud CLI

Install the Google Cloud CLI for Windows from <https://cloud.google.com/sdk/docs/install>.
Then, in a new Git Bash window:

```bash
gcloud auth login
export PROJECT_ID=plotlineai-123456      # yours
gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com iam.googleapis.com
```

### 3. Artifact Registry (where the images live)

```bash
gcloud artifacts repositories create plotlineai \
  --repository-format=docker --location=us-east4
gcloud artifacts repositories set-cleanup-policies plotlineai \
  --location=us-east4 --policy=deploy/cloudrun/cleanup-policy.json --no-dry-run
gcloud auth configure-docker us-east4-docker.pkg.dev
```

The cleanup policy keeps the three most recent versions of each image, which stays under
the free 0.5 GB.

### 4. Neon (the database)

1. Sign up at <https://neon.tech> and create a project:
   - Postgres **16**;
   - region **AWS US East 1 (N. Virginia)**.
2. **Compute:** set the size to **0.25 CU** (both the minimum and the maximum). Leave scale
   to zero on.
3. **Connect:** turn **Connection pooling off** to get the direct endpoint. It looks like
   `postgresql://USER:PASSWORD@ep-xxxx.us-east-1.aws.neon.tech/neondb?sslmode=require`.
4. Split it into the three values the api needs:
   - URL: `jdbc:postgresql://ep-xxxx.us-east-1.aws.neon.tech/neondb?sslmode=require`
   - user: `USER`
   - password: `PASSWORD`

Flyway creates the tables on the api's first start.

### 5. Secrets

Each command prompts for the value, so it never lands in your shell history or in a file:

```bash
secret() { read -rsp "$1: " v; echo; printf %s "$v" | gcloud secrets create "$1" --data-file=-; unset v; }
secret openai-api-key
secret db-url
secret db-user
secret db-password
```

### 6. The runtime service account

The service reads its secrets as this account and can do nothing else:

```bash
gcloud iam service-accounts create plotlineai-runtime --display-name="PlotlineAI runtime"
SA="plotlineai-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
for s in openai-api-key db-url db-user db-password; do
  gcloud secrets add-iam-policy-binding "$s" \
    --member="serviceAccount:${SA}" --role=roles/secretmanager.secretAccessor
done
```

### 7. First deploy, and opening it to the public

Start Docker Desktop, then:

```bash
PROJECT_ID="$PROJECT_ID" deploy/cloudrun/deploy.sh
gcloud run services add-iam-policy-binding plotlineai --region=us-east4 \
  --member=allUsers --role=roles/run.invoker
```

`deploy.sh` does four things:
1. builds both images from the current commit;
2. tags them with the commit's short hash;
3. pushes them;
4. rolls the service onto them.

It then prints the URL, which looks like `https://plotlineai-xxxx.us-east4.run.app`.

### 8. OpenAI limit

At <https://platform.openai.com>, open the project that owns the key and set a monthly
budget, e.g. $5. The app's daily call limit is the first line of defence; this is the
backstop.

## Smoke check after a deploy

Open the URL in a browser, set `URL=https://plotlineai-xxxx.us-east4.run.app` in Git Bash
for the curl checks, and check each of these:

- [ ] The landing page loads, and the six gallery charts render.
- [ ] Upload a CSV. Suggestions appear, one renders, and a refine ("make it a line chart")
      works.
- [ ] Share it, then open the share link in a private window.
- [ ] A forged address does not escape the rate limit. Run this about 40 times against a
      real dataset id; it must end in `429` even though every request claims a new address:
      `curl -s -o /dev/null -w '%{http_code}\n' -X POST -H "Origin: $URL" -H 'content-type: application/json' -H "X-Forwarded-For: 203.0.113.$RANDOM" -d '{}' "$URL/api/backend/charts/render"`
- [ ] The internal budget endpoint is not reachable:
      `curl -s -o /dev/null -w '%{http_code}\n' -X POST "$URL/api/backend/internal/ai-budget/consume"`
      prints `404`.
- [ ] Measure the cold start after 20 idle minutes, and record it below:
      `curl -o /dev/null -s -w '%{time_total}\n' "$URL"`

Measured cold start: _not measured yet_.

## Routine deploys

Commit, then run `PROJECT_ID=... deploy/cloudrun/deploy.sh`. It refuses to run with
uncommitted changes, so every revision maps to a commit.

## Operations

- **Logs:** `gcloud run services logs read plotlineai --region=us-east4 --limit=100`
- **Roll back:**
  1. `gcloud run revisions list --service=plotlineai --region=us-east4`
  2. `gcloud run services update-traffic plotlineai --region=us-east4 --to-revisions=REVISION=100`
  3. The next `deploy.sh` moves traffic to the new revision again.
- **Rotate a secret:**
  1. `read -rsp "value: " v; printf %s "$v" | gcloud secrets versions add openai-api-key --data-file=-; unset v`
  2. `gcloud run services update plotlineai --region=us-east4 --update-labels=rotated=$(date +%s)`
     starts a revision that reads the new version.
- **Back up the database** (the password comes from the Neon console):
  ```bash
  MSYS_NO_PATHCONV=1 docker run --rm postgres:16-alpine \
    pg_dump "postgresql://USER:PASSWORD@ep-xxxx.us-east-1.aws.neon.tech/neondb?sslmode=require" -Fc \
    > plotlineai-$(date +%F).dump
  ```
  Neon's free plan also keeps a short point-in-time restore window.
- **Troubleshooting a deploy that never becomes ready:**
  1. Read the logs.
  2. If `api` cannot reach Postgres, check the `db-url` secret: it must start with
     `jdbc:postgresql://` and end with `sslmode=require`.
  3. `web` only starts once `api` passes its startup probe.
