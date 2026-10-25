import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { AiUnavailableError } from "@/lib/ai/errors";

/**
 * The only file that names a provider or a model. Swapping providers means editing this file
 * alone: suggest.ts, chart-spec.ts and insights.ts spread these settings into their calls.
 */

const DEFAULT_MODEL = "gpt-5-nano";
/**
 * Insights read query results and make claims about them ("the highest", "every month"), which
 * gpt-5-nano got wrong in about one file in seven on the gallery CSVs and gpt-5-mini did not.
 * At their token counts it costs about $0.004 an upload against nano's $0.0008.
 */
const DEFAULT_INSIGHTS_MODEL = "gpt-5-mini";

export type CallSettings = {
  model: LanguageModel;
  /**
   * gpt-5-nano is a reasoning model, and reasoning tokens bill at the output rate. Measured
   * against the gallery CSVs, "minimal" produced the same 640-768 reasoning tokens per call
   * as "low" and slightly worse chart choices, so there is nothing to gain by lowering it.
   */
  reasoning: "low";
  /** Reasoning tokens count towards this, so it must cover them plus three specs. */
  maxOutputTokens: number;
  timeout: number;
  /** Every attempt is billed and counted against the daily ceiling. */
  maxRetries: number;
};

/** For the chart calls: AI_MODEL, gpt-5-nano by default. */
export function callSettings(): CallSettings {
  return settings(process.env.AI_MODEL || DEFAULT_MODEL, 25_000);
}

/**
 * For the insights calls: AI_INSIGHTS_MODEL, gpt-5-mini by default. The research call takes
 * its own longer budget (see insights.ts); this timeout is the writing call's, so the two stay
 * inside web's 60 s.
 */
export function insightSettings(): CallSettings {
  return settings(process.env.AI_INSIGHTS_MODEL || DEFAULT_INSIGHTS_MODEL, 20_000);
}

function settings(modelId: string, timeout: number): CallSettings {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new AiUnavailableError("OPENAI_API_KEY is not configured");

  // OPENAI_BASE_URL points the provider at a stand-in: the end-to-end suite's stub
  // (e2e/ai-stub) or an OpenAI-compatible gateway. Unset, it is api.openai.com.
  const openai = createOpenAI({ apiKey, baseURL: process.env.OPENAI_BASE_URL || undefined });
  return {
    model: openai(modelId),
    reasoning: "low",
    maxOutputTokens: 6000,
    timeout,
    maxRetries: 1,
  };
}
