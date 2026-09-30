import { Validations, type App, type CfnResource } from "aws-cdk-lib";
import { AwsSolutionsChecks, type IApplyRule, type NagPackProps } from "cdk-nag";
import type { IConstruct } from "constructs";

/**
 * cdk-nag's AWS Solutions rules, run on every synth: an unacknowledged finding fails it.
 * Findings accepted on purpose are acknowledged next to the resource they concern, each with
 * its reason, through the two helpers below.
 */
export function addNagChecks(app: App, props: NagPackProps = {}): void {
  Validations.of(app).addPlugins(new PlotlineNagChecks(app, props));
}

/** Accepts one AwsSolutions rule, such as "S1", on a construct and everything under it. */
export function acknowledge(scope: IConstruct, rule: string, reason: string): void {
  Validations.of(scope).acknowledge({ id: `AwsSolutions-${rule}`, reason });
}

/**
 * Accepts the AwsSolutions-IAM5 wildcard findings under a construct that match a pattern.
 *
 * IAM5 reports each wildcard separately ("Action::s3:GetObject*", "Resource::<arn>/uploads/*"),
 * and a resource finding spells out the ARN as it resolves at synth time, including cross-stack
 * export names and the account. Matching a pattern when the rule runs keeps these
 * acknowledgments independent of stack names and accounts.
 */
export function allowWildcards(scope: IConstruct, pattern: RegExp, reason: string): void {
  wildcardAllowances.set(scope, [...(wildcardAllowances.get(scope) ?? []), { pattern, reason }]);
}

const wildcardAllowances = new WeakMap<IConstruct, { pattern: RegExp; reason: string }[]>();

class PlotlineNagChecks extends AwsSolutionsChecks {
  protected override applyRule(params: IApplyRule): void {
    if (params.ruleSuffixOverride !== "IAM5") return super.applyRule(params);
    const rule = params.rule;
    super.applyRule({
      ...params,
      rule: (node: CfnResource) => {
        const result = rule(node);
        if (Array.isArray(result)) {
          for (const finding of result) {
            const allowance = allowanceFor(node, finding);
            if (allowance) acknowledge(node, `IAM5[${finding}]`, allowance.reason);
          }
        }
        return result;
      },
    });
  }
}

function allowanceFor(node: IConstruct, finding: string) {
  for (let scope: IConstruct | undefined = node; scope; scope = scope.node.scope) {
    const allowance = wildcardAllowances.get(scope)?.find((a) => a.pattern.test(finding));
    if (allowance) return allowance;
  }
  return undefined;
}
