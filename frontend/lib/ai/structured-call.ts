import { NoObjectGeneratedError, NoOutputGeneratedError, Output, generateText } from "ai";
import type { z } from "zod";
import { dailyBudget, type DailyBudget } from "@/lib/ai/budget";
import { AiBadOutputError, AiUnavailableError } from "@/lib/ai/errors";
import { callSettings, type CallSettings } from "@/lib/ai/provider";
import { SYSTEM_PROMPT } from "@/lib/ai/prompt";

/** Seams for tests; production uses the real provider and the process-wide budget. */
export type AiDeps = {
  settings?: () => CallSettings;
  budget?: DailyBudget;
};

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
  (deps.budget ?? dailyBudget).consume();

  try {
    const { output } = await generateText({
      ...settings,
      system: SYSTEM_PROMPT,
      prompt: options.prompt,
      output: Output.object({
        schema: options.schema,
        name: options.name,
        description: options.description,
      }),
    });
    return output;
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error) || NoOutputGeneratedError.isInstance(error)) {
      throw new AiBadOutputError("model output did not match the schema", { cause: error });
    }
    throw new AiUnavailableError("model call failed", { cause: error });
  }
}
