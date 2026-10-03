import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as actions from "aws-cdk-lib/aws-cloudwatch-actions";
import type * as sns from "aws-cdk-lib/aws-sns";
import type { Construct } from "constructs";

/**
 * An alarm that emails the owner through the alerts topic when it fires and again when it
 * clears. No data counts as fine: an idle site sends no metrics at all.
 */
export function emailingAlarm(
  scope: Construct,
  id: string,
  topic: sns.ITopic,
  props: Omit<cloudwatch.AlarmProps, "treatMissingData" | "evaluationPeriods">,
): cloudwatch.Alarm {
  const alarm = new cloudwatch.Alarm(scope, id, {
    evaluationPeriods: 1,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    ...props,
  });
  alarm.addAlarmAction(new actions.SnsAction(topic));
  alarm.addOkAction(new actions.SnsAction(topic));
  return alarm;
}
