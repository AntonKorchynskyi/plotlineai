import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as redshift from "aws-cdk-lib/aws-redshiftserverless";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as schedulerTargets from "aws-cdk-lib/aws-scheduler-targets";
import * as cr from "aws-cdk-lib/custom-resources";
import type { Construct } from "constructs";
import { emailingAlarm } from "./alarms.js";
import type { DataStack } from "./data-stack.js";
import { acknowledge, allowWildcards } from "./nag.js";
import type { PipelineStack } from "./pipeline-stack.js";

export interface AnalyticsStackProps extends StackProps {
  data: DataStack;
  pipeline: PipelineStack;
  /** The built redshift-loader bundle; tests pass a stand-in. */
  loaderCode: lambda.Code;
}

const NAMESPACE = "plotlineai";
const WORKGROUP = "plotlineai";
const DATABASE = "analytics";
/** The cost ceiling: at 4 RPU and $0.375 per RPU-hour, about $7.50 a month. */
const MONTHLY_RPU_HOURS = 20;

/**
 * The usage event archive as a queryable warehouse (infra/analytics/*.sql):
 *
 * - Redshift Serverless bills only while a query runs, at the smallest base capacity (4 RPU),
 *   and a monthly usage limit switches it off before it can cost more than about $7.50;
 * - every morning the redshift-loader copies yesterday's archive objects in, and a failed load
 *   emails the owner;
 * - the owner queries the views in Redshift Query Editor v2 (docs/deploy-aws.md).
 *
 * Redshift Serverless has to sit in a VPC. This one has three isolated subnets and nothing
 * else: no internet or NAT gateway, and a security group that admits nothing. COPY reads S3 and
 * the Data API reaches the workgroup through AWS's own network, not this VPC.
 */
export class AnalyticsStack extends Stack {
  readonly loader: lambda.Function;

  constructor(scope: Construct, id: string, props: AnalyticsStackProps) {
    super(scope, id, props);
    const { data, pipeline } = props;
    const bucket = data.analyticsBucket;

    // --- network ---
    const vpc = new ec2.Vpc(this, "Vpc", {
      ipAddresses: ec2.IpAddresses.cidr("10.20.0.0/16"),
      // A workgroup needs subnets in three zones. Named here so a synth without an account
      // still gets three. In this account they are use1-az1, az2 and az4 (not az3, which many
      // services do not support).
      availabilityZones: ["us-east-1a", "us-east-1b", "us-east-1c"],
      natGateways: 0,
      subnetConfiguration: [{ name: "redshift", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 }],
      restrictDefaultSecurityGroup: false,
    });
    acknowledge(vpc, "VPC7", "Nothing in this VPC sends traffic: it only holds the workgroup's endpoints, which admit nothing.");
    const securityGroup = new ec2.SecurityGroup(this, "WorkgroupSecurityGroup", {
      vpc,
      description: "Redshift Serverless workgroup: no inbound, no outbound",
      allowAllOutbound: false,
    });

    // --- the warehouse ---
    // The role COPY uses (IAM_ROLE default): it may read the archive and nothing else.
    const copyRole = new iam.Role(this, "CopyRole", {
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal("redshift.amazonaws.com"),
        new iam.ServicePrincipal("redshift-serverless.amazonaws.com"),
      ),
      description: "Lets Redshift COPY the usage event archive",
    });
    copyRole.addToPolicy(
      new iam.PolicyStatement({ actions: ["s3:GetObject"], resources: [bucket.arnForObjects("events/*")] }),
    );
    copyRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:ListBucket"],
        resources: [bucket.bucketArn],
        conditions: { StringLike: { "s3:prefix": ["events/*"] } },
      }),
    );
    allowWildcards(copyRole, /^Resource::.+\/events\/\*$/, "COPY reads a day's objects, keyed by date and a random id under events/.");

    // The admin sign-in, which the loader and the owner's Query Editor sessions use. Created
    // here rather than with Redshift's managed password, because CloudFormation does not return
    // the managed secret's ARN. The keys are the ones the Data API reads.
    const adminSecret = new secretsmanager.Secret(this, "AdminSecret", {
      secretName: "plotlineai/redshift-admin",
      description: "Redshift Serverless admin sign-in for the plotlineai namespace",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "plotline_admin" }),
        generateStringKey: "password",
        passwordLength: 32,
        // Redshift wants upper and lower case and a digit, and refuses some punctuation.
        excludePunctuation: true,
        requireEachIncludedType: true,
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });
    acknowledge(
      adminSecret,
      "SMG4",
      "Rotation would need its own function and a VPC route; the secret is used only by the loader and the owner.",
    );
    const adminSecretArn = adminSecret.secretArn;

    const namespace = new redshift.CfnNamespace(this, "Namespace", {
      namespaceName: NAMESPACE,
      dbName: DATABASE,
      adminUsername: "plotline_admin",
      // A dynamic reference: CloudFormation reads the password at deploy time, and it never
      // appears in the template.
      adminUserPassword: adminSecret.secretValueFromJson("password").unsafeUnwrap(),
      iamRoles: [copyRole.roleArn],
      defaultIamRoleArn: copyRole.roleArn,
    });
    // Everything in it can be rebuilt from the archive by loading the days again.
    namespace.applyRemovalPolicy(RemovalPolicy.DESTROY);

    const workgroup = new redshift.CfnWorkgroup(this, "Workgroup", {
      workgroupName: WORKGROUP,
      namespaceName: NAMESPACE,
      baseCapacity: 4,
      publiclyAccessible: false,
      enhancedVpcRouting: false,
      subnetIds: vpc.isolatedSubnets.map((subnet) => subnet.subnetId),
      securityGroupIds: [securityGroup.securityGroupId],
    });
    workgroup.node.addDependency(namespace);
    workgroup.applyRemovalPolicy(RemovalPolicy.DESTROY);
    const workgroupArn = workgroup.attrWorkgroupWorkgroupArn;

    // CloudFormation has no usage-limit resource, so a custom resource calls the API.
    const usageLimitArns = [
      workgroupArn,
      namespace.attrNamespaceNamespaceArn,
      this.formatArn({ service: "redshift-serverless", resource: "usagelimit", resourceName: "*" }),
    ];
    const usageLimitCall = (action: string, parameters: Record<string, unknown>): cr.AwsSdkCall => ({
      service: "redshift-serverless",
      action,
      parameters,
      physicalResourceId: cr.PhysicalResourceId.fromResponse("usageLimit.usageLimitId"),
      outputPaths: ["usageLimit.usageLimitId"],
    });
    const usageLimit = new cr.AwsCustomResource(this, "UsageLimit", {
      onCreate: usageLimitCall("CreateUsageLimit", {
        resourceArn: workgroupArn,
        usageType: "serverless-compute",
        period: "monthly",
        amount: MONTHLY_RPU_HOURS,
        breachAction: "deactivate",
      }),
      onUpdate: usageLimitCall("UpdateUsageLimit", {
        usageLimitId: new cr.PhysicalResourceIdReference(),
        amount: MONTHLY_RPU_HOURS,
        breachAction: "deactivate",
      }),
      onDelete: {
        service: "redshift-serverless",
        action: "DeleteUsageLimit",
        parameters: { usageLimitId: new cr.PhysicalResourceIdReference() },
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: [
            "redshift-serverless:CreateUsageLimit",
            "redshift-serverless:UpdateUsageLimit",
            "redshift-serverless:DeleteUsageLimit",
          ],
          resources: usageLimitArns,
        }),
      ]),
      installLatestAwsSdk: false,
      logGroup: new logs.LogGroup(this, "UsageLimitLogs", {
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });
    usageLimit.node.addDependency(workgroup);
    allowWildcards(usageLimit, /usagelimit\/\*$/, "Usage limit ids are generated by Redshift; only this account's can match.");

    // --- the nightly load ---
    this.loader = new lambda.Function(this, "Loader", {
      functionName: "plotlineai-redshift-loader",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.X86_64,
      code: props.loaderCode,
      handler: "index.handler",
      memorySize: 256,
      // A paused workgroup takes a minute or so to resume before the load itself runs.
      timeout: Duration.minutes(5),
      // The schedule retries a failed invocation itself; Lambda's own retries would double up.
      retryAttempts: 0,
      logGroup: new logs.LogGroup(this, "LoaderLogs", {
        logGroupName: "/aws/lambda/plotlineai-redshift-loader",
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      environment: {
        WORKGROUP_NAME: WORKGROUP,
        DATABASE_NAME: DATABASE,
        ADMIN_SECRET_ARN: adminSecretArn,
        ANALYTICS_BUCKET: bucket.bucketName,
      },
    });
    this.loader.node.addDependency(workgroup);
    this.loader.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["redshift-data:BatchExecuteStatement"],
        resources: [workgroupArn],
      }),
    );
    // Statement ids are not resources IAM can name. As in AWS's own Data API policies, these
    // are limited to the statements this role started.
    this.loader.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["redshift-data:DescribeStatement", "redshift-data:GetStatementResult"],
        resources: ["*"],
        conditions: { StringEquals: { "redshift-data:statement-owner-iam-userid": "${aws:userid}" } },
      }),
    );
    this.loader.addToRolePolicy(
      new iam.PolicyStatement({ actions: ["secretsmanager:GetSecretValue"], resources: [adminSecretArn] }),
    );
    this.loader.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:ListBucket"],
        resources: [bucket.bucketArn],
        conditions: { StringLike: { "s3:prefix": ["events/*"] } },
      }),
    );
    // For the loader and the usage limit's custom-resource function, which CDK adds at stack level.
    acknowledge(
      this,
      "IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]",
      "AWSLambdaBasicExecutionRole only lets a function write its own logs.",
    );
    allowWildcards(
      this.loader,
      /^Resource::\*$/,
      "Data API statement ids cannot be named in IAM; the statement-owner condition limits these to the loader's own.",
    );

    // The schedule's role, which CDK adds at stack level, may invoke the loader and its versions.
    allowWildcards(this, /^Resource::<Loader[A-Za-z0-9]*\.Arn>:\*$/, "Invoking a function covers its versions and aliases.");
    new scheduler.Schedule(this, "NightlyLoad", {
      scheduleName: "plotlineai-nightly-load",
      description: "Loads yesterday's usage events into Redshift",
      // After midnight UTC plus the archiver's batching window, so the day is complete.
      schedule: scheduler.ScheduleExpression.cron({ minute: "0", hour: "6" }),
      target: new schedulerTargets.LambdaInvoke(this.loader, {
        input: scheduler.ScheduleTargetInput.fromObject({
          scheduledTime: scheduler.ContextAttribute.scheduledTime,
        }),
        retryAttempts: 2,
        maxEventAge: Duration.hours(2),
      }),
    });

    emailingAlarm(this, "LoaderErrors", pipeline.alerts, {
      alarmName: "plotlineai-redshift-loader-errors",
      alarmDescription: "The nightly Redshift load failed or was throttled.",
      metric: new cloudwatch.MathExpression({
        expression: "errors + throttles",
        usingMetrics: {
          errors: this.loader.metricErrors({ period: Duration.minutes(15), statistic: cloudwatch.Stats.SUM }),
          throttles: this.loader.metricThrottles({ period: Duration.minutes(15), statistic: cloudwatch.Stats.SUM }),
        },
        period: Duration.minutes(15),
        label: "Failed loads",
      }),
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });

    new CfnOutput(this, "WorkgroupName", { value: WORKGROUP });
    new CfnOutput(this, "AdminSecretArn", {
      value: adminSecretArn,
      description: "Sign in to Query Editor v2 with this secret (docs/deploy-aws.md)",
    });
  }
}
