import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { AiUnavailableError } from "@/lib/ai/errors";

/**
 * The only file that names a provider or a model. Swapping providers means editing this file
 * alone: suggest.ts, chart-spec.ts and insights.ts spread these settings into their calls.
 */

/**
 * Charts. On 68 public and gallery CSVs it answered for every file (gpt-5-nano, which OpenAI
 * shuts down on 2026-12-11, failed two), with fewer specs refused, at about $0.0005 a file.
 */
const DEFAULT_MODEL = "gpt-6-luna";
/**
 * Insights read query results and make claims about them ("the highest", "every month"). On
 * 62 public CSVs gpt-6.1-terra got 0.3% of its insights wrong and none misleading, against
 * 0.9% and 4.8% for gpt-5-mini. gpt-6-luna wrote wrong superlatives and comparisons at either
 * effort (2.1% at low, 1.3% at medium), as gpt-5-nano did. Terra costs about $0.03 an upload.
 */
const DEFAULT_INSIGHTS_MODEL = "gpt-6.1-terra";

export type CallSettings = {
  model: LanguageModel;
  /**
   * Both models reason, and reasoning tokens bill at the output rate. At "low" they spend about
   * 100 per call; "none" saved little on the charts and had more specs refused.
   */
  reasoning: "low";
  /** Reasoning tokens count towards this, so it must cover them plus three specs. */
  maxOutputTokens: number;
  timeout: number;
  /** Every attempt is billed and counted against the daily ceiling. */
  maxRetries: number;
};

/** For the chart calls: AI_MODEL, gpt-6-luna by default. */
export function callSettings(): CallSettings {
  return settings(process.env.AI_MODEL || DEFAULT_MODEL, 25_000);
}

/**
 * For the insights calls: AI_INSIGHTS_MODEL, gpt-6.1-terra by default. The research call takes
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
