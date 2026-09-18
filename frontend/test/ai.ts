import { MockLanguageModelV4 } from "ai/test";
import { createDailyBudget, type DailyBudget } from "@/lib/ai/budget";
import type { CallSettings } from "@/lib/ai/provider";
import type { DatasetDetail } from "@/lib/backend";

/** Test helpers for the AI layer: a mock model, settings around it, and a sample dataset. */

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};

/** A model that answers every call with `output`, serialized as the JSON text it would send. */
export function mockModel(output: unknown) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [
        { type: "text", text: typeof output === "string" ? output : JSON.stringify(output) },
      ],
      finishReason: { unified: "stop", raw: undefined },
      usage,
      warnings: [],
    }),
  });
}

/** A model whose provider call fails, as a network error or an API outage would. */
export function failingModel(error = new Error("provider exploded")) {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      throw error;
    },
  });
}

export const settingsFor = (model: MockLanguageModelV4) => (): CallSettings => ({
  model,
  reasoning: "low",
  maxOutputTokens: 6000,
  timeout: 25_000,
  maxRetries: 0,
});

export const freshBudget = (limit = 100): DailyBudget => createDailyBudget({ limit });

/** Every text part the model was sent across all calls, joined, for asserting on prompts. */
export function sentText(model: MockLanguageModelV4): string {
  return model.doGenerateCalls
    .flatMap((call) => call.prompt)
    .flatMap((message) =>
      typeof message.content === "string"
        ? [message.content]
        : message.content.flatMap((part) => ("text" in part ? [part.text] : [])),
    )
    .join("\n");
}

export const dataset: DatasetDetail = {
  datasetId: "d945b7b2-b960-4811-819f-7797944520ff",
  schema: [
    { name: "region", type: "STRING", cardinality: 5, nullCount: 0, format: null },
    { name: "rep", type: "STRING", cardinality: 12, nullCount: 0, format: null },
    { name: "revenue", type: "INTEGER", cardinality: 12, nullCount: 0, format: null },
  ],
  rowCount: 12,
  sampleRows: [
    { region: "North America", rep: "A. Rivera", revenue: "128400" },
    { region: "Europe", rep: "L. Novak", revenue: "88300" },
  ],
};

/** A spec in the exact form the model returns: every optional field spelled null. */
export const modelSpec = (over: Record<string, unknown> = {}) => ({
  chartType: "bar",
  stacked: null,
  title: "Revenue by region",
  dimension: { column: "region", bucket: null },
  measures: [{ column: "revenue", aggregation: "sum", label: null }],
  breakdown: null,
  filters: null,
  sort: { by: "measure", direction: "desc" },
  limit: null,
  ...over,
});
