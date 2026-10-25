import { MockLanguageModelV4 } from "ai/test";
import type { DailyBudget } from "@/lib/ai/budget";
import { AiBudgetRefusedError } from "@/lib/ai/errors";
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

/** A model that answers its calls with `outputs` in turn, repeating the last. */
export function sequenceModel(outputs: unknown[]) {
  let call = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [
        { type: "text", text: JSON.stringify(outputs[Math.min(call++, outputs.length - 1)]) },
      ],
      finishReason: { unified: "stop", raw: undefined },
      usage,
      warnings: [],
    }),
  });
}

/**
 * A model for a tool loop: each entry is one step, either query_data calls (their inputs)
 * or the final structured answer. Steps past the script repeat the last.
 */
export function toolLoopModel(steps: ({ queries: unknown[] } | { answer: unknown })[]) {
  let call = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      const step = steps[Math.min(call++, steps.length - 1)];
      if ("queries" in step) {
        return {
          content: step.queries.map((input, i) => ({
            type: "tool-call" as const,
            toolCallId: `call_${call}_${i}`,
            toolName: "query_data",
            input: JSON.stringify(input),
          })),
          finishReason: { unified: "tool-calls" as const, raw: undefined },
          usage,
          warnings: [],
        };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(step.answer) }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage,
        warnings: [],
      };
    },
  });
}

/** A query_data input in the exact form the model sends: every optional field spelled null. */
export const modelQuery = (over: Record<string, unknown> = {}) => ({
  dimension: { column: "region", bucket: null },
  measures: [{ column: "revenue", aggregation: "sum", label: null }],
  breakdown: null,
  filters: null,
  sort: { by: "measure", direction: "desc" },
  limit: 5,
  ...over,
});

/** A validator that passes every spec, or refuses those whose title is listed. */
export const validatorRefusing =
  (...titles: string[]) =>
  async (_datasetId: string, specs: { title: string }[]) =>
    specs.map((s) => ({
      error: titles.includes(s.title) ? "This aggregation requires a numeric column" : null,
      empty: false,
    }));

/** A validator under which the specs whose title is listed render, but draw nothing. */
export const validatorFindingEmpty =
  (...titles: string[]) =>
  async (_datasetId: string, specs: { title: string }[]) =>
    specs.map((s) => ({ error: null, empty: titles.includes(s.title) }));

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

/** An in-memory stand-in for the api's daily budget, which says how much is left. */
export function freshBudget(limit = 100): DailyBudget & { remaining(): number } {
  let used = 0;
  return {
    async consume() {
      if (used >= limit) throw new AiBudgetRefusedError("daily AI call limit reached");
      used += 1;
    },
    remaining: () => limit - used,
  };
}

/**
 * Every text part the model was sent, joined, for asserting on prompts: across all calls, or
 * only call number `call` (from 0).
 */
export function sentText(model: MockLanguageModelV4, call?: number): string {
  const calls = call === undefined ? model.doGenerateCalls : [model.doGenerateCalls[call]];
  return calls
    .flatMap((c) => c.prompt)
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
