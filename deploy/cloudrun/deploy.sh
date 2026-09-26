#!/usr/bin/env bash
# Builds both images from the current commit, pushes them to Artifact Registry and rolls the
# Cloud Run service onto them. The one-time setup is docs/deploy-cloud-run.md.
#
#   PROJECT_ID=my-project deploy/cloudrun/deploy.sh
set -euo pipefail

: "${PROJECT_ID:?set PROJECT_ID to your Google Cloud project id}"
REGION="${REGION:-us-east4}"

cd "$(git rev-parse --show-toplevel)"

# Every deploy maps to a commit, so a revision can always be traced back to its source.
if [[ -n "$(git status --porcelain)" ]]; then
  echo "The working tree has uncommitted changes. Commit or stash them first." >&2
  exit 1
fi

TAG="$(git rev-parse --short HEAD)"
REPO="${REGION}-docker.pkg.dev/${PROJECT_ID}/plotlineai"

echo "Building ${TAG}..."
docker build --platform linux/amd64 -t "${REPO}/api:${TAG}" backend
# The rewrite destination is baked in at build time; api is a sidecar on localhost.
docker build --platform linux/amd64 \
  --build-arg BACKEND_INTERNAL_URL=http://localhost:8080 \
  -t "${REPO}/web:${TAG}" frontend

echo "Pushing..."
docker push "${REPO}/api:${TAG}"
docker push "${REPO}/web:${TAG}"

manifest="$(mktemp)"
trap 'rm -f "$manifest"' EXIT
sed -e "s|\${PROJECT_ID}|${PROJECT_ID}|g" \
    -e "s|\${REGION}|${REGION}|g" \
    -e "s|\${TAG}|${TAG}|g" \
    deploy/cloudrun/service.yaml > "$manifest"

echo "Deploying..."
gcloud run services replace "$manifest" --region "$REGION" --project "$PROJECT_ID"

echo "Live at: $(gcloud run services describe plotlineai --region "$REGION" \
  --project "$PROJECT_ID" --format='value(status.url)')"
