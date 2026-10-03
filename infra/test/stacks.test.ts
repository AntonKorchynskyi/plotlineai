import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import { describe, expect, it } from "vitest";
import { AppStack } from "../lib/app-stack.js";
import { CiStack } from "../lib/ci-stack.js";
import { DataStack } from "../lib/data-stack.js";
import { addNagChecks, allowWildcards } from "../lib/nag.js";
import { PipelineStack } from "../lib/pipeline-stack.js";

const GITHUB = { owner: "AntonKorchynskyi", ownerId: 122495439, repo: "plotlineai", repoId: 1309326523 };

/** A stand-in for the built artifacts, which tests do not need. */
const stubCode = () => {
  const dir = mkdtempSync(join(tmpdir(), "plotlineai-"));
  writeFileSync(join(dir, "stub.txt"), "stub");
  return lambda.Code.fromAsset(dir);
};

const build = ({ reservedConcurrency = 20, nag = false } = {}) => {
  const app = new App();
  const env = { account: "123456789012", region: "us-east-1" };
  const data = new DataStack(app, "Data", { env });
  const pipeline = new PipelineStack(app, "Pipeline", {
    env,
    data,
    alertEmail: "owner@example.com",
    archiverCode: stubCode(),
  });
  const site = new AppStack(app, "Site", {
    env,
    data,
    pipeline,
    alertEmail: "owner@example.com",
    reservedConcurrency,
    apiCode: stubCode(),
    webCode: stubCode(),
    staticAssets: s3deploy.Source.data("chunk.js", "x"),
  });
  const ci = new CiStack(app, "Ci", { env, github: GITHUB });
  if (nag) {
    addNagChecks(app);
    app.synth();
  }
  return {
    data: Template.fromStack(data),
    pipeline: Template.fromStack(pipeline),
    site: Template.fromStack(site),
    ci: Template.fromStack(ci),
  };
};

const { data, pipeline, site, ci } = build();

const functionNamed = (name: string) =>
  Object.values(site.findResources("AWS::Lambda::Function")).find(
    (f) => f.Properties.FunctionName === name,
  )!;

describe("DataStack", () => {
  it("keys both tables on a string pk, expires items on expiresAt, and bills per request", () => {
    for (const name of ["plotlineai-app", "plotlineai-rate-limits"]) {
      data.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
        TableName: name,
        KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }],
        AttributeDefinitions: [{ AttributeName: "pk", AttributeType: "S" }],
        BillingMode: "PAY_PER_REQUEST",
        TimeToLiveSpecification: { AttributeName: "expiresAt", Enabled: true },
      });
    }
  });

  it("keeps point-in-time recovery on the app table, where shares are permanent", () => {
    data.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      TableName: "plotlineai-app",
      Replicas: [
        Match.objectLike({
          PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
        }),
      ],
    });
  });

  it("retains every table and bucket if the stack is deleted", () => {
    for (const type of ["AWS::DynamoDB::GlobalTable", "AWS::S3::Bucket"]) {
      for (const resource of Object.values(data.findResources(type))) {
        expect(resource.DeletionPolicy).toBe("Retain");
      }
    }
  });

  it("blocks public access, requires TLS and encrypts every bucket", () => {
    const buckets = {
      ...data.findResources("AWS::S3::Bucket"),
      ...site.findResources("AWS::S3::Bucket"),
    };
    expect(Object.keys(buckets)).toHaveLength(3);
    for (const bucket of Object.values(buckets)) {
      expect(bucket.Properties.PublicAccessBlockConfiguration).toEqual({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      });
      expect(bucket.Properties.BucketEncryption).toBeDefined();
    }
    const policies = [
      ...Object.values(data.findResources("AWS::S3::BucketPolicy")),
      ...Object.values(site.findResources("AWS::S3::BucketPolicy")),
    ];
    expect(policies).toHaveLength(3);
    for (const policy of policies) {
      expect(JSON.stringify(policy)).toContain('"aws:SecureTransport":"false"');
    }
  });

  it("clears uploads after a day and datasets after two, and lets browsers PUT only", () => {
    data.hasResourceProperties("AWS::S3::Bucket", {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({ Prefix: "uploads/", ExpirationInDays: 1, Status: "Enabled" }),
          Match.objectLike({ Prefix: "datasets/", ExpirationInDays: 2, Status: "Enabled" }),
        ]),
      },
      CorsConfiguration: {
        CorsRules: [Match.objectLike({ AllowedMethods: ["PUT"], AllowedHeaders: ["Content-Type"] })],
      },
    });
  });

  it("keeps the event archive for 400 days", () => {
    data.hasResourceProperties("AWS::S3::Bucket", {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({ Prefix: "events/", ExpirationInDays: 400, Status: "Enabled" }),
        ]),
      },
    });
  });
});

describe("PipelineStack", () => {
  const alarms = () => [
    ...Object.values(pipeline.findResources("AWS::CloudWatch::Alarm")),
    ...Object.values(site.findResources("AWS::CloudWatch::Alarm")),
  ];

  it("names the bus both publishers use", () => {
    pipeline.hasResourceProperties("AWS::Events::EventBus", { Name: "plotlineai" });
  });

  it("queues every PlotlineAI event for the archiver, with a dead-letter queue", () => {
    pipeline.hasResourceProperties("AWS::Events::Rule", {
      EventPattern: { source: [{ prefix: "plotlineai." }] },
      Targets: [Match.objectLike({ Arn: { "Fn::GetAtt": [Match.stringLikeRegexp("ArchiveQueue"), "Arn"] } })],
    });
    pipeline.hasResourceProperties("AWS::SQS::Queue", {
      QueueName: "analytics-events",
      SqsManagedSseEnabled: true,
      VisibilityTimeout: 240,
      RedrivePolicy: {
        deadLetterTargetArn: { "Fn::GetAtt": [Match.stringLikeRegexp("ArchiveDlq"), "Arn"] },
        maxReceiveCount: 5,
      },
    });
    pipeline.hasResourceProperties("AWS::SQS::Queue", {
      QueueName: "analytics-events-dlq",
      MessageRetentionPeriod: 14 * 24 * 3600,
    });
  });

  it("drains the queue in batches, retrying only the messages that failed", () => {
    pipeline.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "plotlineai-event-archiver",
      Runtime: "nodejs24.x",
      Handler: "index.handler",
      MemorySize: 256,
      Timeout: 30,
    });
    pipeline.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      BatchSize: 100,
      MaximumBatchingWindowInSeconds: 60,
      FunctionResponseTypes: ["ReportBatchItemFailures"],
      ScalingConfig: { MaximumConcurrency: 2 },
    });
  });

  it("lets the archiver add objects under events/ and nothing else in S3", () => {
    const statements = Object.values(pipeline.findResources("AWS::IAM::Policy")).flatMap(
      (p) => p.Properties.PolicyDocument.Statement,
    );
    const s3Statements = statements.filter((st) => [st.Action].flat().some((a: string) => a.startsWith("s3:")));
    expect(s3Statements).toHaveLength(1);
    expect(s3Statements[0].Action).toBe("s3:PutObject");
    expect(JSON.stringify(s3Statements[0].Resource)).toContain("/events/*");
  });

  it("emails the owner when a daily quota runs out", () => {
    pipeline.hasResourceProperties("AWS::SNS::Subscription", {
      Protocol: "email",
      Endpoint: "owner@example.com",
    });
    pipeline.hasResourceProperties("AWS::Events::Rule", {
      EventPattern: { source: ["plotlineai.api"], "detail-type": ["quota.exhausted"] },
      Targets: [
        Match.objectLike({
          Arn: { Ref: Match.stringLikeRegexp("Alerts") },
          InputTransformer: Match.objectLike({
            InputPathsMap: { "detail-quota": "$.detail.quota", "detail-limit": "$.detail.limit", "detail-day": "$.detail.day" },
          }),
        }),
      ],
    });
  });

  it("has six alarms, each emailing the owner when it fires and when it clears", () => {
    const all = alarms();
    expect(all.map((a) => a.Properties.AlarmName).sort()).toEqual([
      "plotlineai-analytics-dlq-not-empty",
      "plotlineai-api-errors",
      "plotlineai-archiver-errors",
      "plotlineai-cloudfront-5xx",
      "plotlineai-throttles",
      "plotlineai-web-errors",
    ]);
    for (const alarm of all) {
      expect(alarm.Properties.AlarmActions).toHaveLength(1);
      expect(alarm.Properties.OKActions).toEqual(alarm.Properties.AlarmActions);
      expect(JSON.stringify(alarm.Properties.AlarmActions)).toContain("Alerts");
      expect(alarm.Properties.TreatMissingData).toBe("notBreaching");
    }
  });

  it("keeps the archiver's logs for two weeks", () => {
    pipeline.hasResourceProperties("AWS::Logs::LogGroup", {
      LogGroupName: "/aws/lambda/plotlineai-event-archiver",
      RetentionInDays: 14,
    });
  });
});

describe("AppStack", () => {
  it("puts no function in a VPC", () => {
    for (const fn of Object.values(site.findResources("AWS::Lambda::Function"))) {
      expect(fn.Properties.VpcConfig).toBeUndefined();
    }
  });

  it("runs the api on java25 with SnapStart, behind an IAM-only URL on the live alias", () => {
    const api = functionNamed("plotlineai-api");
    expect(api.Properties.Runtime).toBe("java25");
    expect(api.Properties.SnapStart).toEqual({ ApplyOn: "PublishedVersions" });
    expect(api.Properties.MemorySize).toBe(1536);
    expect(api.Properties.Timeout).toBe(30);
    expect(api.Properties.Environment.Variables.MANAGEMENT_PORT).toBe("-1");
    expect(api.Properties.Environment.Variables.EVENT_BUS_NAME).toBeDefined();
    site.hasResourceProperties("AWS::Lambda::Alias", { Name: "live" });
    site.hasResourceProperties("AWS::Lambda::Url", {
      AuthType: "AWS_IAM",
      Qualifier: "live",
    });
  });

  it("runs web on nodejs24.x behind the Web Adapter, with a public URL locked by the origin check", () => {
    const web = functionNamed("plotlineai-web");
    expect(web.Properties.Runtime).toBe("nodejs24.x");
    expect(web.Properties.Handler).toBe("run.sh");
    expect(web.Properties.Timeout).toBe(60);
    const env = web.Properties.Environment.Variables;
    expect(env).toMatchObject({
      AWS_LAMBDA_EXEC_WRAPPER: "/opt/bootstrap",
      BACKEND_AUTH: "iam",
      CLIENT_IP_SOURCE: "cloudfront",
      OPENAI_API_KEY_PARAM: "/plotlineai/openai-api-key",
    });
    expect(env.ORIGIN_VERIFY_SECRET_ARN).toBeDefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.EVENT_BUS_NAME).toBeDefined();
    expect(JSON.stringify(web.Properties.Layers)).toContain("LambdaAdapterLayerX86:30");
    site.hasResourceProperties("AWS::Lambda::Url", { AuthType: "NONE" });
  });

  it("caps each function's concurrency, or leaves it unset when asked", () => {
    expect(functionNamed("plotlineai-api").Properties.ReservedConcurrentExecutions).toBe(20);
    expect(functionNamed("plotlineai-web").Properties.ReservedConcurrentExecutions).toBe(20);
    const uncapped = build({ reservedConcurrency: 0 }).site;
    for (const fn of Object.values(uncapped.findResources("AWS::Lambda::Function"))) {
      expect(fn.Properties.ReservedConcurrentExecutions).toBeUndefined();
    }
  });

  it("lets only web invoke the api's URL", () => {
    site.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Action: "lambda:InvokeFunctionUrl", Effect: "Allow" }),
        ]),
      },
    });
  });

  it("lets both functions publish to the bus, and only to it", () => {
    const putEvents = Object.values(site.findResources("AWS::IAM::Policy"))
      .flatMap((p) => p.Properties.PolicyDocument.Statement)
      .filter((st) => st.Action === "events:PutEvents");
    expect(putEvents).toHaveLength(2);
    for (const statement of putEvents) {
      expect(JSON.stringify(statement.Resource)).toMatch(/GetAttBus[A-Za-z0-9]*Arn/);
    }
  });

  it("grants no IAM statement a wildcard action or a bare wildcard resource", () => {
    for (const stack of [site, pipeline, ci]) {
      for (const policy of Object.values(stack.findResources("AWS::IAM::Policy"))) {
        for (const statement of policy.Properties.PolicyDocument.Statement) {
          const actions = [statement.Action].flat();
          const resources = [statement.Resource].flat();
          expect(actions, JSON.stringify(statement)).not.toContain("*");
          expect(resources, JSON.stringify(statement)).not.toContain("*");
        }
      }
    }
  });

  it("serves build output from S3 and everything else from web, with HSTS", () => {
    site.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: [Match.objectLike({ PathPattern: "_next/static/*" })],
        Origins: Match.arrayWith([
          Match.objectLike({
            OriginCustomHeaders: [Match.objectLike({ HeaderName: "X-Origin-Verify" })],
          }),
        ]),
      }),
    });
    site.hasResourceProperties("AWS::CloudFront::ResponseHeadersPolicy", {
      ResponseHeadersPolicyConfig: Match.objectLike({
        SecurityHeadersConfig: {
          StrictTransportSecurity: Match.objectLike({ IncludeSubdomains: true, Override: true }),
        },
      }),
    });
  });

  it("passes the browser's host to web, which the cross-site check compares with Origin", () => {
    const fns = Object.values(site.findResources("AWS::CloudFront::Function"));
    expect(fns).toHaveLength(1);
    const code: string = fns[0].Properties.FunctionCode;
    expect(code).toContain("x-forwarded-host");
    site.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          FunctionAssociations: [Match.objectLike({ EventType: "viewer-request" })],
        }),
      }),
    });
  });

  it("keeps function logs for two weeks", () => {
    const groups = Object.values(site.findResources("AWS::Logs::LogGroup"));
    expect(groups.length).toBeGreaterThanOrEqual(2);
    for (const group of groups) expect(group.Properties.RetentionInDays).toBe(14);
  });

  it("emails the owner before the month passes $5", () => {
    site.hasResourceProperties("AWS::Budgets::Budget", {
      Budget: Match.objectLike({ BudgetLimit: { Amount: 5, Unit: "USD" }, TimeUnit: "MONTHLY" }),
      NotificationsWithSubscribers: Match.arrayWith([
        Match.objectLike({
          Subscribers: [{ SubscriptionType: "EMAIL", Address: "owner@example.com" }],
        }),
      ]),
    });
  });
});

describe("CiStack", () => {
  it("trusts only the repository's production environment", () => {
    ci.hasResourceProperties("AWS::IAM::Role", {
      RoleName: "plotlineai-deploy",
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Action: "sts:AssumeRoleWithWebIdentity",
            Condition: {
              StringEquals: {
                "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                "token.actions.githubusercontent.com:sub":
                  "repo:AntonKorchynskyi@122495439/plotlineai@1309326523:environment:production",
              },
            },
          }),
        ],
      },
    });
  });

  it("can do nothing but hand the deployment to CDK's bootstrap roles", () => {
    ci.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: [
          {
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Resource: "arn:aws:iam::123456789012:role/cdk-hnb659fds-*-123456789012-us-east-1",
          },
        ],
      },
    });
  });
});

describe("cdk-nag (AwsSolutions)", () => {
  it("synthesizes with every finding either fixed or acknowledged with a reason", () => {
    expect(() => build({ nag: true })).not.toThrow();
  });

  it("also passes when synth has no account, as in CI", () => {
    const app = new App();
    new CiStack(app, "Ci", { env: { region: "us-east-1" }, github: GITHUB });
    addNagChecks(app);
    expect(() => app.synth()).not.toThrow();
  });

  it("accepts only the wildcards an allowance matches", () => {
    const synthWith = (allow: RegExp) => {
      const app = new App();
      const stack = new Stack(app, "Probe", { env: { account: "123456789012", region: "us-east-1" } });
      const role = new iam.Role(stack, "Role", { assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com") });
      role.addToPolicy(
        new iam.PolicyStatement({ actions: ["s3:GetObject"], resources: ["arn:aws:s3:::b/uploads/*"] }),
      );
      allowWildcards(role, allow, "test");
      addNagChecks(app);
      app.synth();
    };
    expect(() => synthWith(/\/uploads\/\*$/)).not.toThrow();
    expect(() => synthWith(/\/datasets\/\*$/)).toThrow(/AwsSolutions-IAM5/);
  });
});
