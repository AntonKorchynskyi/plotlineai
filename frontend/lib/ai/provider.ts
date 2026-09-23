import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { AiUnavailableError } from "@/lib/ai/errors";

/**
 * The only file that names a provider or a model. Swapping providers means editing this file
 * alone: suggest.ts and chart-spec.ts spread these settings into their calls.
 */

const DEFAULT_MODEL = "gpt-5-nano";

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

export function callSettings(): CallSettings {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new AiUnavailableError("OPENAI_API_KEY is not configured");

  const openai = createOpenAI({ apiKey });
  return {
    model: openai(process.env.AI_MODEL || DEFAULT_MODEL),
    reasoning: "low",
    maxOutputTokens: 6000,
    timeout: 25_000,
    maxRetries: 1,
  };
}
