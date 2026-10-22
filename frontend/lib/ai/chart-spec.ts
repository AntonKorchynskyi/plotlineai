import { AiBadOutputError } from "@/lib/ai/errors";
import { describePrompt, retryPrompt } from "@/lib/ai/prompt";
import { checkSpecs } from "@/lib/ai/spec-check";
import { structuredCall, type AiDeps } from "@/lib/ai/structured-call";
import type { DatasetDetail } from "@/lib/backend";
import { ChartSpecModelSchema, toChartSpec, type ChartSpec } from "@/lib/chart-spec";

/** An empty result is the user's to see: the chart screen offers to drop the filters. */
const KEEP_EMPTY = { refuseEmpty: false };

/**
 * One chart for a free-text request. With `currentSpec` it refines the chart the user is
 * looking at; without, it designs one from scratch. A spec the renderer would refuse is asked
 * for once more with the reason; refused twice, it is a bad answer.
 */
export async function describeChart(
  dataset: DatasetDetail,
  instruction: string,
  currentSpec?: ChartSpec,
  deps: AiDeps = {},
): Promise<ChartSpec> {
  const prompt = describePrompt(dataset, instruction, currentSpec);
  const first = await ask(prompt, deps);
  const firstCheck = await checkSpecs(dataset.datasetId, [{ spec: first }], deps, KEEP_EMPTY);
  if (firstCheck.refused.length === 0) return first;

  const second = await ask(retryPrompt(prompt, firstCheck.refused), deps);
  const secondCheck = await checkSpecs(dataset.datasetId, [{ spec: second }], deps, KEEP_EMPTY);
  if (secondCheck.refused.length > 0) {
    throw new AiBadOutputError("the spec does not fit the dataset");
  }
  return second;
}

async function ask(prompt: string, deps: AiDeps): Promise<ChartSpec> {
  const output = await structuredCall(
    {
      schema: ChartSpecModelSchema,
      name: "chart_spec",
      description: "One chart for the user's request.",
      prompt,
    },
    deps,
  );

  try {
    return toChartSpec(output);
  } catch (error) {
    throw new AiBadOutputError("the spec broke the contract", { cause: error });
  }
}
