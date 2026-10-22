import { z } from "zod";
import { AiBadOutputError, AiNoChartError } from "@/lib/ai/errors";
import { retryPrompt, suggestPrompt } from "@/lib/ai/prompt";
import { checkSpecs } from "@/lib/ai/spec-check";
import { structuredCall, type AiDeps } from "@/lib/ai/structured-call";
import type { DatasetDetail } from "@/lib/backend";
import { ChartSpecModelSchema, toChartSpec, type ChartSpec } from "@/lib/chart-spec";

export const SUGGESTION_COUNT = 3;
export const MAX_RATIONALE_LENGTH = 160;

export type Suggestion = { rationale: string; spec: ChartSpec };

const SuggestionSetSchema = z.strictObject({
  suggestions: z.array(z.strictObject({ rationale: z.string(), spec: ChartSpecModelSchema })),
});

/**
 * Up to three chart suggestions for a freshly uploaded dataset. Each is checked against the
 * dataset's schema; when some fail, the model is asked once more with the reasons, and the
 * charts that pass from both answers are kept. None passing at all is {@link AiNoChartError}.
 */
export async function suggestCharts(
  dataset: DatasetDetail,
  deps: AiDeps = {},
): Promise<Suggestion[]> {
  const prompt = suggestPrompt(dataset);
  const first = await ask(prompt, deps);
  const firstCheck = await checkSpecs(dataset.datasetId, first, deps, { refuseEmpty: true });
  if (firstCheck.refused.length === 0) return first;

  let second: Suggestion[];
  try {
    second = await ask(retryPrompt(prompt, firstCheck.refused), deps);
  } catch (failure) {
    // A retry that goes wrong costs only the replacements: what already passed still shows.
    if (firstCheck.passed.length > 0 && failure instanceof AiBadOutputError) {
      return firstCheck.passed;
    }
    throw failure;
  }
  const secondCheck = await checkSpecs(dataset.datasetId, second, deps, { refuseEmpty: true });
  const titles = new Set(firstCheck.passed.map((s) => s.spec.title));
  const kept = [
    ...firstCheck.passed,
    ...secondCheck.passed.filter((s) => !titles.has(s.spec.title)),
  ].slice(0, SUGGESTION_COUNT);
  if (kept.length === 0) throw new AiNoChartError("no suggested chart fits the dataset");
  return kept;
}

async function ask(prompt: string, deps: AiDeps): Promise<Suggestion[]> {
  const output = await structuredCall(
    {
      schema: SuggestionSetSchema,
      name: "chart_suggestions",
      description: "Three different charts worth looking at for the dataset.",
      prompt,
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
