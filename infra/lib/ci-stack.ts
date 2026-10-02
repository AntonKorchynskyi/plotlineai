import { Stack, type StackProps } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";
import { allowWildcards } from "./nag.js";

export interface CiStackProps extends StackProps {
  /** "owner/repo" on GitHub. */
  repository: string;
}

/**
 * Lets GitHub Actions deploy without any stored AWS key. The deploy job proves who it is with a
 * short-lived OIDC token from GitHub, and AWS trades it for one-hour credentials of a role that
 * can do one thing: hand the deployment to CDK's own bootstrap roles. Only jobs in the
 * repository's "production" environment qualify, and that environment requires the owner's
 * approval (docs/deploy-aws.md).
 */
export class CiStack extends Stack {
  readonly deployRole: iam.Role;

  constructor(scope: Construct, id: string, props: CiStackProps) {
    super(scope, id, props);

    const github = new iam.OpenIdConnectProvider(this, "GitHub", {
      url: "https://token.actions.githubusercontent.com",
      clientIds: ["sts.amazonaws.com"],
    });

    this.deployRole = new iam.Role(this, "Deploy", {
      roleName: "plotlineai-deploy",
      assumedBy: new iam.WebIdentityPrincipal(github.openIdConnectProviderArn, {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": `repo:${props.repository}:environment:production`,
        },
      }),
    });

    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: [`arn:aws:iam::${this.account}:role/cdk-hnb659fds-*-${this.account}-${this.region}`],
      }),
    );
    allowWildcards(
      this.deployRole,
      // The account is a number, or <AWS::AccountId> when synth runs without credentials (CI).
      /^Resource::arn:aws:iam::(\d{12}|<AWS::AccountId>):role\/cdk-hnb659fds-\*-/,
      "The CDK bootstrap roles (deploy, file publishing, lookup) share this documented name pattern.",
    );
  }
}
