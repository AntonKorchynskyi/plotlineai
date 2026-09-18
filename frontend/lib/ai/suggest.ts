import { z } from "zod";
import { AiBadOutputError } from "@/lib/ai/errors";
import { suggestPrompt } from "@/lib/ai/prompt";
import { structuredCall, type AiDeps } from "@/lib/ai/structured-call";
import type { DatasetDetail } from "@/lib/backend";
import { ChartSpecModelSchema, toChartSpec, type ChartSpec } from "@/lib/chart-spec";

export const SUGGESTION_COUNT = 3;
export const MAX_RATIONALE_LENGTH = 160;

export type Suggestion = { rationale: string; spec: ChartSpec };

const SuggestionSetSchema = z.strictObject({
  suggestions: z.array(z.strictObject({ rationale: z.string(), spec: ChartSpecModelSchema })),
});

/** Three chart suggestions for a freshly uploaded dataset, from one model call. */
export async function suggestCharts(
  dataset: DatasetDetail,
  deps?: AiDeps,
): Promise<Suggestion[]> {
  const output = await structuredCall(
    {
      schema: SuggestionSetSchema,
      name: "chart_suggestions",
      description: "Three different charts worth looking at for the dataset.",
      prompt: suggestPrompt(dataset),
    },
    deps,
  );

  if (output.suggestions.length < SUGGESTION_COUNT) {
    throw new AiBadOutputError(`expected ${SUGGESTION_COUNT} suggestions`);
  }

  try {
    return output.suggestions.slice(0, SUGGESTION_COUNT).map((s) => ({
      // A long rationale is a display nuisance, not a broken chart: trim it.
      rationale: s.rationale.trim().slice(0, MAX_RATIONALE_LENGTH),
      spec: toChartSpec(s.spec),
    }));
  } catch (error) {
    throw new AiBadOutputError("a suggested spec broke the contract", { cause: error });
  }
}
