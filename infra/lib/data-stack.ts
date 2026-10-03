import { Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";
import { acknowledge } from "./nag.js";

/**
 * Everything that holds data, kept apart from the code that uses it: redeploying or even
 * deleting the app stack never touches these, and they are retained if this stack is deleted.
 *
 * The key schema (a string partition key "pk", nothing else) is mirrored for local runs in
 * deploy/local/init-aws.sh and backend/src/test/java/com/plotlineai/backend/LocalTables.java.
 */
export class DataStack extends Stack {
  /** Datasets, shares and the daily counters. Only the api may use it. */
  readonly appTable: dynamodb.TableV2;
  /** Rate-limit windows. Only web may use it. */
  readonly rateLimitTable: dynamodb.TableV2;
  /** Uploaded CSVs and parsed rows, both short-lived. */
  readonly dataBucket: s3.Bucket;
  /** The usage event archive the event-archiver writes and Phase 13 loads into Redshift. */
  readonly analyticsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, { ...props, terminationProtection: true });

    const table = (tableId: string, tableName: string, pointInTimeRecovery: boolean) =>
      new dynamodb.TableV2(this, tableId, {
        tableName,
        partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
        billing: dynamodb.Billing.onDemand(),
        timeToLiveAttribute: "expiresAt",
        pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: pointInTimeRecovery },
        removalPolicy: RemovalPolicy.RETAIN,
      });
    // Shares are permanent, so the app table can be restored to any second of the last 35 days.
    this.appTable = table("AppTable", "plotlineai-app", true);
    // Counters that expire within minutes: nothing worth restoring.
    this.rateLimitTable = table("RateLimitTable", "plotlineai-rate-limits", false);

    const privateBucket = (bucketId: string, props: Partial<s3.BucketProps> = {}) =>
      new s3.Bucket(this, bucketId, {
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        enforceSSL: true,
        encryption: s3.BucketEncryption.S3_MANAGED,
        objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
        removalPolicy: RemovalPolicy.RETAIN,
        ...props,
      });

    this.dataBucket = privateBucket("DataBucket", {
      lifecycleRules: [
        // An upload is read and deleted when it is finalized; this clears the ones never finalized.
        { id: "uploads", prefix: "uploads/", expiration: Duration.days(1) },
        // Datasets expire after 24 hours (DATASET_TTL); their files go a day later.
        { id: "datasets", prefix: "datasets/", expiration: Duration.days(2) },
        { id: "abandoned-multipart", abortIncompleteMultipartUploadAfter: Duration.days(1) },
      ],
      // The browser PUTs uploads straight here. Any origin may make the request, because the
      // presigned URL, not the origin, is what authorizes it; pinning the site's origin would
      // make this stack depend on the CloudFront distribution in the app stack.
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT],
          allowedOrigins: ["*"],
          allowedHeaders: ["Content-Type"],
          maxAge: 3600,
        },
      ],
    });
    acknowledge(this.dataBucket, "S1", "Access logs would cost more than the app; objects live a day or two.");

    this.analyticsBucket = privateBucket("AnalyticsBucket", {
      lifecycleRules: [
        // A little over a year: enough for year-on-year questions, and the files are tiny.
        { id: "events", prefix: "events/", expiration: Duration.days(400) },
        { id: "abandoned-multipart", abortIncompleteMultipartUploadAfter: Duration.days(1) },
      ],
    });
    acknowledge(this.analyticsBucket, "S1", "Only the archiver writes here; its own logs record every object.");
  }
}
