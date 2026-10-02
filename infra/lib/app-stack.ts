import { Annotations, CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as ssm from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";
import type { DataStack } from "./data-stack.js";
import { acknowledge, allowWildcards } from "./nag.js";

/** The action groups CDK's bucket grants use (grantReadWrite and the deployment's own). */
const S3_GRANT_ACTIONS = /^Action::s3:(Abort|DeleteObject|GetBucket|GetObject|List)\*$/;
const S3_GRANT_REASON = "CDK's standard S3 grant action groups, scoped to one bucket.";
const BASIC_EXECUTION_ROLE =
  "IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]";
const LOGS_ONLY_REASON = "AWSLambdaBasicExecutionRole only lets the function write its own logs.";

/** The Lambda Web Adapter layer that runs Next.js's own HTTP server inside Lambda. */
const WEB_ADAPTER_LAYER_VERSION = 30;

/** The SSM SecureString holding the OpenAI key. The owner creates it by hand (docs/deploy-aws.md). */
export const OPENAI_KEY_PARAMETER = "/plotlineai/openai-api-key";

export interface AppStackProps extends StackProps {
  data: DataStack;
  /** Where the monthly budget alert goes. */
  alertEmail: string;
  /** Per-function cap on concurrent instances; 0 leaves it unset (accounts with a low quota). */
  reservedConcurrency: number;
  /** The built artifacts; tests pass stand-ins. */
  apiCode: lambda.Code;
  webCode: lambda.Code;
  staticAssets: s3deploy.ISource;
}

/**
 * The running app: CloudFront in front of the web function, which calls the api function.
 *
 * - web's function URL is public (CloudFront OAC would make every browser POST send a payload
 *   hash), so CloudFront adds a secret X-Origin-Verify header and web refuses requests without
 *   it (frontend/proxy.ts).
 * - api's function URL requires SigV4 from web's role, so nothing else can reach it.
 * - No function runs in a VPC: every AWS call goes to a public endpoint, authorized by IAM.
 */
export class AppStack extends Stack {
  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);
    const { data } = props;
    const reserved = props.reservedConcurrency > 0 ? props.reservedConcurrency : undefined;

    const logGroup = (logId: string, name: string) =>
      new logs.LogGroup(this, logId, {
        logGroupName: `/aws/lambda/${name}`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: RemovalPolicy.DESTROY,
      });

    // --- api: Spring Boot, resumed from a SnapStart snapshot ---
    const api = new lambda.Function(this, "Api", {
      functionName: "plotlineai-api",
      runtime: lambda.Runtime.JAVA_25,
      architecture: lambda.Architecture.X86_64,
      code: props.apiCode,
      handler: "com.plotlineai.backend.lambda.StreamLambdaHandler::handleRequest",
      memorySize: 1536,
      timeout: Duration.seconds(30),
      snapStart: lambda.SnapStartConf.ON_PUBLISHED_VERSIONS,
      reservedConcurrentExecutions: reserved,
      logGroup: logGroup("ApiLogs", "plotlineai-api"),
      environment: {
        PLOTLINEAI_APP_TABLE: data.appTable.tableName,
        PLOTLINEAI_DATA_BUCKET: data.dataBucket.bucketName,
        DATASET_TTL: "PT24H",
        AI_DAILY_CALL_LIMIT: "500",
        UPLOAD_DAILY_LIMIT: "300",
        // Actuator has no use behind a function URL, and a separate port breaks the container.
        MANAGEMENT_PORT: "-1",
        // A short-lived function gains little from the optimizing compiler's warm-up.
        JAVA_TOOL_OPTIONS: "-XX:+TieredCompilation -XX:TieredStopAtLevel=1",
      },
    });
    const apiLive = new lambda.Alias(this, "ApiLive", { aliasName: "live", version: api.currentVersion });
    Annotations.of(api).acknowledgeWarning(
      "@aws-cdk/aws-lambda:snapStartRequirePublish",
      "Every deploy publishes api.currentVersion, and the live alias points at it.",
    );
    const apiUrl = apiLive.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.AWS_IAM });

    data.appTable.grantReadWriteData(api);
    data.dataBucket.grantReadWrite(api, "uploads/*");
    data.dataBucket.grantReadWrite(api, "datasets/*");
    acknowledge(api, BASIC_EXECUTION_ROLE, LOGS_ONLY_REASON);
    allowWildcards(api, S3_GRANT_ACTIONS, S3_GRANT_REASON);
    allowWildcards(
      api,
      /^Resource::.+\/(uploads|datasets)\/\*$/,
      "Objects are keyed by random ids under these two prefixes; the api owns both.",
    );

    // --- web: the Next.js standalone server behind Lambda Web Adapter ---
    const originSecret = new secretsmanager.Secret(this, "OriginVerify", {
      description: "The X-Origin-Verify value CloudFront sends and web requires",
      generateSecretString: { excludePunctuation: true, passwordLength: 48 },
    });
    acknowledge(
      originSecret,
      "SMG4",
      "CloudFront gets the value at deploy time, so rotating it means a redeploy; it guards no data.",
    );
    const openAiKey = ssm.StringParameter.fromSecureStringParameterAttributes(this, "OpenAiKey", {
      parameterName: OPENAI_KEY_PARAMETER,
    });

    const web = new lambda.Function(this, "Web", {
      functionName: "plotlineai-web",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.X86_64,
      code: props.webCode,
      handler: "run.sh",
      memorySize: 1024,
      // An AI call may take 25 s, and is retried once.
      timeout: Duration.seconds(60),
      reservedConcurrentExecutions: reserved,
      logGroup: logGroup("WebLogs", "plotlineai-web"),
      layers: [
        lambda.LayerVersion.fromLayerVersionArn(
          this,
          "WebAdapter",
          `arn:aws:lambda:${this.region}:753240598075:layer:LambdaAdapterLayerX86:${WEB_ADAPTER_LAYER_VERSION}`,
        ),
      ],
      environment: {
        AWS_LAMBDA_EXEC_WRAPPER: "/opt/bootstrap",
        AWS_LWA_PORT: "3000",
        // A TCP check: an HTTP one would be refused by the origin check.
        AWS_LWA_READINESS_CHECK_PROTOCOL: "tcp",
        PORT: "3000",
        HOSTNAME: "127.0.0.1",
        NODE_ENV: "production",
        NEXT_TELEMETRY_DISABLED: "1",
        BACKEND_INTERNAL_URL: apiUrl.url,
        BACKEND_AUTH: "iam",
        CLIENT_IP_SOURCE: "cloudfront",
        RATE_LIMIT_TABLE: data.rateLimitTable.tableName,
        OPENAI_API_KEY_PARAM: OPENAI_KEY_PARAMETER,
        ORIGIN_VERIFY_SECRET_ARN: originSecret.secretArn,
        // The origin the api's presigned URLs point at, for the page's CSP (connect-src).
        UPLOAD_ORIGIN: `https://${data.dataBucket.bucketDomainName}`,
        AI_MODEL: "gpt-5-nano",
      },
    });
    const webUrl = web.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });
    acknowledge(web, BASIC_EXECUTION_ROLE, LOGS_ONLY_REASON);

    apiUrl.grantInvokeUrl(web);
    apiLive.grantInvoke(web);
    data.rateLimitTable.grantReadWriteData(web);
    originSecret.grantRead(web);
    openAiKey.grantRead(web);

    // --- CloudFront: the only public entry ---
    // The site's build output. It lives here rather than in the data stack because its access
    // policy names this distribution, and everything in it can be rebuilt from the repository.
    const assets = new s3.Bucket(this, "AssetsBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    acknowledge(assets, "S1", "Access logs would cost more than the app; CloudFront is the only reader.");

    const headers = new cloudfront.ResponseHeadersPolicy(this, "Hsts", {
      securityHeadersBehavior: {
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(730),
          includeSubdomains: true,
          override: true,
        },
      },
    });

    // The function URL answers only to its own host name, so CloudFront cannot pass on the
    // browser's Host. This copies it into X-Forwarded-Host (replacing any value the client
    // sent), which web's cross-site check compares with Origin (frontend/lib/security/origin.ts).
    const forwardHost = new cloudfront.Function(this, "ForwardHost", {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      comment: "Passes the viewer's Host to web as X-Forwarded-Host",
      code: cloudfront.FunctionCode.fromInline(
        [
          "function handler(event) {",
          "  var request = event.request;",
          "  request.headers['x-forwarded-host'] = { value: request.headers.host.value };",
          "  return request;",
          "}",
        ].join("\n"),
      ),
    });

    const site = new cloudfront.Distribution(this, "Site", {
      comment: "PlotlineAI",
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      defaultBehavior: {
        origin: new origins.FunctionUrlOrigin(webUrl, {
          customHeaders: { "X-Origin-Verify": originSecret.secretValue.unsafeUnwrap() },
          readTimeout: Duration.seconds(60),
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        // Every viewer header but Host (a function URL answers only to its own), plus
        // CloudFront-Viewer-Address, the client address the rate limiter keys on.
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        responseHeadersPolicy: headers,
        functionAssociations: [
          { function: forwardHost, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
        ],
      },
      additionalBehaviors: {
        "_next/static/*": {
          origin: origins.S3BucketOrigin.withOriginAccessControl(assets),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          responseHeadersPolicy: headers,
        },
      },
    });
    acknowledge(site, "CFR1", "A public demo with no reason to block countries.");
    acknowledge(site, "CFR2", "WAF costs about $5 a month, the whole budget; web rate-limits itself.");
    acknowledge(site, "CFR3", "Access logs are out of scope for cost; the functions log every request.");
    acknowledge(
      site,
      "CFR4",
      "The default cloudfront.net certificate fixes the TLS policy; a custom domain is out of scope.",
    );

    // Hashed file names never change content, so old builds' files stay (prune: false) for
    // browsers still running the previous version.
    const deployment = new s3deploy.BucketDeployment(this, "StaticAssets", {
      sources: [props.staticAssets],
      destinationBucket: assets,
      destinationKeyPrefix: "_next/static",
      prune: false,
      cacheControl: [s3deploy.CacheControl.fromString("public, max-age=31536000, immutable")],
    });
    // The copy runs in a function CDK provides and manages.
    const copier = deployment.handlerRole.node.scope!;
    acknowledge(copier, "L1", "CDK pins this handler's runtime and updates it with aws-cdk-lib.");
    acknowledge(copier, BASIC_EXECUTION_ROLE, LOGS_ONLY_REASON);
    allowWildcards(copier, S3_GRANT_ACTIONS, S3_GRANT_REASON);
    allowWildcards(
      copier,
      /^Resource::.+\/\*$/,
      "It reads the build from CDK's asset bucket and writes it into the assets bucket.",
    );

    new budgets.CfnBudget(this, "MonthlyBudget", {
      budget: {
        budgetName: "plotlineai-monthly",
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: { amount: 5, unit: "USD" },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            notificationType: "ACTUAL",
            comparisonOperator: "GREATER_THAN",
            threshold: 80,
            thresholdType: "PERCENTAGE",
          },
          subscribers: [{ subscriptionType: "EMAIL", address: props.alertEmail }],
        },
        {
          notification: {
            notificationType: "FORECASTED",
            comparisonOperator: "GREATER_THAN",
            threshold: 100,
            thresholdType: "PERCENTAGE",
          },
          subscribers: [{ subscriptionType: "EMAIL", address: props.alertEmail }],
        },
      ],
    });

    new CfnOutput(this, "SiteUrl", { value: `https://${site.distributionDomainName}` });
  }
}
