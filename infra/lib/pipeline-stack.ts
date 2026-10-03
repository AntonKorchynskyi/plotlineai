import { Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as sqs from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";
import { emailingAlarm } from "./alarms.js";
import type { DataStack } from "./data-stack.js";
import { acknowledge, allowWildcards } from "./nag.js";

export interface PipelineStackProps extends StackProps {
  data: DataStack;
  /** Where alerts go. The address gets a confirmation email from SNS before anything else. */
  alertEmail: string;
  /** The built event-archiver bundle; tests pass a stand-in. */
  archiverCode: lambda.Code;
}

const ARCHIVER_TIMEOUT = Duration.seconds(30);
const BATCHING_WINDOW = Duration.seconds(60);

/**
 * Where usage events go after the api and web publish them (infra/events/schema.md):
 *
 * - every event on the bus is queued and archived to S3 by the event-archiver, in batches;
 * - a daily quota running out is emailed to the owner straight away;
 * - alarms on this stack's own resources email the owner too. The app stack adds the alarms on
 *   its functions and CloudFront to the same topic.
 */
export class PipelineStack extends Stack {
  readonly bus: events.EventBus;
  readonly alerts: sns.Topic;
  readonly archiver: lambda.Function;

  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);
    const { data } = props;

    this.bus = new events.EventBus(this, "Bus", { eventBusName: "plotlineai" });

    this.alerts = new sns.Topic(this, "Alerts", {
      topicName: "plotlineai-alerts",
      displayName: "PlotlineAI alerts",
      enforceSSL: true,
    });
    this.alerts.addSubscription(new subscriptions.EmailSubscription(props.alertEmail));
    acknowledge(
      this.alerts,
      "SNS2",
      "EventBridge and CloudWatch cannot publish to a topic under the AWS-managed SNS key, and a " +
        "customer-managed key is out of scope; the messages carry no personal data.",
    );

    // --- the archive route: bus -> queue -> archiver -> S3 ---
    const dlq = new sqs.Queue(this, "ArchiveDlq", {
      queueName: "analytics-events-dlq",
      retentionPeriod: Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
    });
    acknowledge(dlq, "SQS3", "This is the dead-letter queue; its alarm emails the owner.");

    const queue = new sqs.Queue(this, "ArchiveQueue", {
      queueName: "analytics-events",
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      // AWS's guidance for a Lambda event source: six times the function's timeout, plus the
      // batching window, so a batch is never handed out twice while it is still being written.
      visibilityTimeout: Duration.seconds(ARCHIVER_TIMEOUT.toSeconds() * 6 + BATCHING_WINDOW.toSeconds()),
      deadLetterQueue: { queue: dlq, maxReceiveCount: 5 },
    });

    new events.Rule(this, "ArchiveEverything", {
      eventBus: this.bus,
      description: "Queues every PlotlineAI event for the archive",
      eventPattern: { source: events.Match.prefix("plotlineai.") },
      targets: [new targets.SqsQueue(queue)],
    });

    this.archiver = new lambda.Function(this, "Archiver", {
      functionName: "plotlineai-event-archiver",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.X86_64,
      code: props.archiverCode,
      handler: "index.handler",
      memorySize: 256,
      timeout: ARCHIVER_TIMEOUT,
      logGroup: new logs.LogGroup(this, "ArchiverLogs", {
        logGroupName: "/aws/lambda/plotlineai-event-archiver",
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      environment: { ANALYTICS_BUCKET: data.analyticsBucket.bucketName },
    });
    this.archiver.addEventSource(
      new SqsEventSource(queue, {
        batchSize: 100,
        maxBatchingWindow: BATCHING_WINDOW,
        reportBatchItemFailures: true,
        // The account runs 10 functions at once in total; the archive is never in a hurry.
        maxConcurrency: 2,
      }),
    );
    this.archiver.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:PutObject"],
        resources: [data.analyticsBucket.arnForObjects("events/*")],
      }),
    );
    acknowledge(
      this.archiver,
      "IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]",
      "AWSLambdaBasicExecutionRole only lets the function write its own logs.",
    );
    allowWildcards(
      this.archiver,
      /^Resource::.+\/events\/\*$/,
      "Archive objects are keyed by date and a random id under events/; the archiver only adds them.",
    );

    // --- alerts ---
    const field = (path: string) => events.EventField.fromPath(path);
    new events.Rule(this, "QuotaExhausted", {
      eventBus: this.bus,
      description: "Emails the owner when a daily quota runs out (once per quota and day)",
      eventPattern: { source: ["plotlineai.api"], detailType: ["quota.exhausted"] },
      targets: [
        new targets.SnsTopic(this.alerts, {
          message: events.RuleTargetInput.fromText(
            `PlotlineAI: the daily ${field("$.detail.quota")} quota of ${field("$.detail.limit")} ` +
              `ran out on ${field("$.detail.day")} (UTC). Requests are refused until midnight UTC.`,
          ),
        }),
      ],
    });

    emailingAlarm(this, "DlqNotEmpty", this.alerts, {
      alarmName: "plotlineai-analytics-dlq-not-empty",
      alarmDescription: "Events the archiver gave up on are waiting in analytics-events-dlq.",
      metric: dlq.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5),
        statistic: cloudwatch.Stats.MAXIMUM,
      }),
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });
    emailingAlarm(this, "ArchiverErrors", this.alerts, {
      alarmName: "plotlineai-archiver-errors",
      alarmDescription: "The event-archiver failed.",
      metric: this.archiver.metricErrors({ period: Duration.minutes(15), statistic: cloudwatch.Stats.SUM }),
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });
  }
}
