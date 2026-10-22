import {
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  generateText,
  type LanguageModelUsage,
} from "ai";
import type { z } from "zod";
import { dailyBudget, type DailyBudget } from "@/lib/ai/budget";
import { AiBadOutputError, AiUnavailableError } from "@/lib/ai/errors";
import { callSettings, type CallSettings } from "@/lib/ai/provider";
import { SYSTEM_PROMPT } from "@/lib/ai/prompt";
import type { ChartSpec } from "@/lib/chart-spec";

/**
 * What each call cost, in tokens. Reasoning tokens bill at the output rate and dominate the
 * bill for a reasoning model, and cached input bills at a tenth of fresh input, so both are
 * worth watching. Counts only: no prompt, no dataset, no output.
 */
function logUsage(name: string, settings: CallSettings, usage: LanguageModelUsage) {
  console.info(
    JSON.stringify({
      event: "ai_call",
      call: name,
      model: modelId(settings),
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.outputTokenDetails?.reasoningTokens,
    }),
  );
}

/**
 * What one request used, filled in as it goes: the model once settings resolve, the token
 * counts as each model call answers (summed when a refused answer is retried), and how many
 * calls were made and specs refused. The route reports it in its `ai.called` event.
 */
export type AiCallRecord = {
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  attempts: number;
  invalidSpecs: number;
};

export const emptyCallRecord = (): AiCallRecord => ({
  model: null,
  inputTokens: null,
  outputTokens: null,
  reasoningTokens: null,
  attempts: 0,
  invalidSpecs: 0,
});

const add = (total: number | null, more: number | undefined) =>
  more === undefined ? total : (total ?? 0) + more;

/** Checks specs against a dataset: per spec, null when it renders or why it does not. */
export type SpecValidator = (datasetId: string, specs: ChartSpec[]) => Promise<(string | null)[]>;

/** Seams for tests; production uses the real provider, budget and api. */
export type AiDeps = {
  settings?: () => CallSettings;
  budget?: DailyBudget;
  record?: AiCallRecord;
  validate?: SpecValidator;
};

const modelId = (settings: CallSettings) =>
  typeof settings.model === "string" ? settings.model : settings.model.modelId;

/**
 * The one schema-constrained model call both AI features make. No loop, no tools: the
 * output can only ever be the given structure.
 *
 * Failures come out as one of two errors: AiBadOutputError when the model answered with
 * something unusable, AiUnavailableError for everything else (no key, budget spent, provider
 * down or slow). The provider's own error stays in `cause`, for logs only.
 */
export async function structuredCall<T>(
  options: { schema: z.ZodType<T>; name: string; description: string; prompt: string },
  deps: AiDeps = {},
): Promise<T> {
  // Resolve settings first, so a missing key does not spend the budget.
  const settings = (deps.settings ?? callSettings)();
  if (deps.record) deps.record.model = modelId(settings);
  await (deps.budget ?? dailyBudget).consume();
  if (deps.record) deps.record.attempts++;

  try {
    const result = await generateText({
      ...settings,
      system: SYSTEM_PROMPT,
      prompt: options.prompt,
      output: Output.object({
        schema: options.schema,
        name: options.name,
        description: options.description,
      }),
    });
    logUsage(options.name, settings, result.usage);
    if (deps.record) {
      deps.record.inputTokens = add(deps.record.inputTokens, result.usage.inputTokens);
      deps.record.outputTokens = add(deps.record.outputTokens, result.usage.outputTokens);
      deps.record.reasoningTokens = add(
        deps.record.reasoningTokens,
        result.usage.outputTokenDetails?.reasoningTokens,
      );
    }
    return result.output;
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error) || NoOutputGeneratedError.isInstance(error)) {
      throw new AiBadOutputError("model output did not match the schema", { cause: error });
    }
    throw new AiUnavailableError("model call failed", { cause: error });
  }
}
