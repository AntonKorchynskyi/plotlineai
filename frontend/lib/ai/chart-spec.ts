import { AiBadOutputError } from "@/lib/ai/errors";
import { describePrompt } from "@/lib/ai/prompt";
import { structuredCall, type AiDeps } from "@/lib/ai/structured-call";
import type { DatasetDetail } from "@/lib/backend";
import { ChartSpecModelSchema, toChartSpec, type ChartSpec } from "@/lib/chart-spec";

/**
 * One chart for a free-text request. With `currentSpec` it refines the chart the user is
 * looking at; without, it designs one from scratch.
 */
export async function describeChart(
  dataset: DatasetDetail,
  instruction: string,
  currentSpec?: ChartSpec,
  deps?: AiDeps,
): Promise<ChartSpec> {
  const output = await structuredCall(
    {
      schema: ChartSpecModelSchema,
      name: "chart_spec",
      description: "One chart for the user's request.",
      prompt: describePrompt(dataset, instruction, currentSpec),
    },
    deps,
  );

  try {
    return toChartSpec(output);
  } catch (error) {
    throw new AiBadOutputError("the spec broke the contract", { cause: error });
  }
}
