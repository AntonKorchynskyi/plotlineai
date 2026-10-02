#!/bin/sh
# Creates what CDK creates on AWS (infra/lib/data-stack.ts) in the local stand-ins: the two
# DynamoDB tables in DynamoDB Local, with TTL on expiresAt, and a check that S3Mock has made
# the data bucket. api and web wait for it to succeed; it is safe to rerun.
set -eu

dynamodb=http://dynamodb:8000
s3=http://s3:9090

wait_for() {
  tries=0
  until "$@" > /dev/null 2>&1; do
    tries=$((tries + 1))
    if [ "$tries" -ge 60 ]; then
      echo "gave up waiting for: $*" >&2
      exit 1
    fi
    sleep 1
  done
}

wait_for aws dynamodb list-tables --endpoint-url "$dynamodb"

for table in plotlineai-app plotlineai-rate-limits; do
  if ! aws dynamodb describe-table --endpoint-url "$dynamodb" --table-name "$table" > /dev/null 2>&1; then
    aws dynamodb create-table --endpoint-url "$dynamodb" --table-name "$table" \
      --attribute-definitions AttributeName=pk,AttributeType=S \
      --key-schema AttributeName=pk,KeyType=HASH \
      --billing-mode PAY_PER_REQUEST > /dev/null
    # Inside the branch: enabling TTL twice is an error, and compose reruns this script
    # whenever a service that waits on it is recreated.
    aws dynamodb update-time-to-live --endpoint-url "$dynamodb" --table-name "$table" \
      --time-to-live-specification Enabled=true,AttributeName=expiresAt > /dev/null
  fi
  echo "table ready: $table"
done

wait_for aws s3api head-bucket --endpoint-url "$s3" --bucket plotlineai-data
echo "bucket ready: plotlineai-data"
