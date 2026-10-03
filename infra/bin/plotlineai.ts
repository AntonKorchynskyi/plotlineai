import { App } from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import { AppStack } from "../lib/app-stack.js";
import { CiStack } from "../lib/ci-stack.js";
import { DataStack } from "../lib/data-stack.js";
import { addNagChecks } from "../lib/nag.js";
import { PipelineStack } from "../lib/pipeline-stack.js";

/**
 * The PlotlineAI stacks, all in us-east-1. Built artifacts are expected in place:
 *   backend:  ./mvnw -B package -DskipTests        -> backend/target/backend-lambda.zip
 *   frontend: npm run build && npm run build:lambda -> frontend/.lambda, frontend/.next/static
 *   infra:    npm run build:lambda                  -> infra/lambda/event-archiver/dist
 *
 * Context:
 *   alertEmail            where alerts go: the $5 budget and the SNS alerts topic (required)
 *   reservedConcurrency   per-function cap, default 0 (unset): the account's concurrency
 *                         limit then caps both functions together. Reserving needs a limit
 *                         of at least the reservations plus 10.
 */
const app = new App();
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: "us-east-1" };

const data = new DataStack(app, "PlotlineData", { env });

const alertEmail: string = app.node.tryGetContext("alertEmail") ?? "";
if (!alertEmail) {
  throw new Error("Pass the alert address: cdk <command> -c alertEmail=you@example.com");
}
const pipeline = new PipelineStack(app, "PlotlinePipeline", {
  env,
  data,
  alertEmail,
  archiverCode: lambda.Code.fromAsset("lambda/event-archiver/dist"),
});
new AppStack(app, "PlotlineApp", {
  env,
  data,
  pipeline,
  alertEmail,
  reservedConcurrency: Number(app.node.tryGetContext("reservedConcurrency") ?? 0),
  apiCode: lambda.Code.fromAsset("../backend/target/backend-lambda.zip"),
  webCode: lambda.Code.fromAsset("../frontend/.lambda"),
  staticAssets: s3deploy.Source.asset("../frontend/.next/static"),
});

new CiStack(app, "PlotlineCi", {
  env,
  github: { owner: "AntonKorchynskyi", ownerId: 122495439, repo: "plotlineai", repoId: 1309326523 },
});

// The AWS Solutions security rules; an unacknowledged finding fails synth.
addNagChecks(app, { verbose: true });
