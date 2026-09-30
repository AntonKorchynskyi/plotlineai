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
  const site = new AppStack(app, "Site", {
    env,
    data,
    alertEmail: "owner@example.com",
    reservedConcurrency,
    apiCode: stubCode(),
    webCode: stubCode(),
    staticAssets: s3deploy.Source.data("chunk.js", "x"),
  });
  const ci = new CiStack(app, "Ci", { env, repository: "AntonKorchynskyi/plotlineai" });
  if (nag) {
    addNagChecks(app);
    app.synth();
  }
  return {
    data: Template.fromStack(data),
    site: Template.fromStack(site),
    ci: Template.fromStack(ci),
  };
};

const { data, site, ci } = build();

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
    expect(Object.keys(buckets)).toHaveLength(2);
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
    expect(policies).toHaveLength(2);
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

  it("grants no IAM statement a wildcard action or a bare wildcard resource", () => {
    for (const stack of [site, ci]) {
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
                  "repo:AntonKorchynskyi/plotlineai:environment:production",
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
    new CiStack(app, "Ci", { env: { region: "us-east-1" }, repository: "AntonKorchynskyi/plotlineai" });
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
