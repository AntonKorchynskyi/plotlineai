import { afterEach, describe, expect, it, vi } from "vitest";
import { AiBadOutputError, AiUnavailableError } from "@/lib/ai/errors";
import { MAX_RATIONALE_LENGTH, suggestCharts } from "@/lib/ai/suggest";
import { SYSTEM_PROMPT } from "@/lib/ai/prompt";
import {
  dataset,
  failingModel,
  freshBudget,
  mockModel,
  modelSpec,
  sentText,
  settingsFor,
} from "@/test/ai";

const three = {
  suggestions: [
    { rationale: "Five regions, one number: a ranked bar reads fastest.", spec: modelSpec() },
    {
      rationale: "Twelve reps with long names read best sideways.",
      spec: modelSpec({
        chartType: "horizontalBar",
        title: "Revenue by rep",
        dimension: { column: "rep", bucket: null },
        limit: 10,
      }),
    },
    {
      rationale: "Few regions summing to a total is the part-to-whole case.",
      spec: modelSpec({ chartType: "doughnut", title: "Share of revenue", sort: null }),
    },
  ],
};

afterEach(() => vi.unstubAllEnvs());

describe("suggestCharts", () => {
  it("returns three suggestions, each a contract ChartSpec with its rationale", async () => {
    const model = mockModel(three);
    const result = await suggestCharts(dataset, {
      settings: settingsFor(model),
      budget: freshBudget(),
    });

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      rationale: "Five regions, one number: a ranked bar reads fastest.",
      spec: {
        chartType: "bar",
        title: "Revenue by region",
        dimension: { column: "region" },
        measures: [{ column: "revenue", aggregation: "sum" }],
        sort: { by: "measure", direction: "desc" },
      },
    });
    expect(result.map((s) => s.spec.chartType)).toEqual(["bar", "horizontalBar", "doughnut"]);
  });

  it("makes exactly one model call", async () => {
    const model = mockModel(three);
    await suggestCharts(dataset, { settings: settingsFor(model), budget: freshBudget() });
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("sends the system rules and the dataset, and asks for structured output", async () => {
    const model = mockModel(three);
    await suggestCharts(dataset, { settings: settingsFor(model), budget: freshBudget() });

    const text = sentText(model);
    expect(text).toContain(SYSTEM_PROMPT);
    expect(text).toContain("North America");
    expect(model.doGenerateCalls[0].responseFormat?.type).toBe("json");
  });

  it("sends a schema OpenAI strict structured outputs accept", async () => {
    const model = mockModel(three);
    await suggestCharts(dataset, { settings: settingsFor(model), budget: freshBudget() });
    const format = model.doGenerateCalls[0].responseFormat;
    const schema = format?.type === "json" ? format.schema : undefined;
    expect(schema).toBeDefined();

    // Strict mode: every object closed and every property required (absent is spelled null).
    // String length keywords are not supported there, and array bounds are left out by
    // choice; both are enforced after the call by the contract schema. Numeric bounds are
    // supported, and Zod emits them for .int().
    const unsupported = ["minLength", "maxLength", "minItems", "maxItems"];
    const visit = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (node === null || typeof node !== "object") return;
      const n = node as Record<string, unknown>;
      for (const key of unsupported) expect(n, `schema uses ${key}`).not.toHaveProperty(key);
      if (n.type === "object" && n.properties) {
        expect(n.additionalProperties).toBe(false);
        expect([...(n.required as string[])].sort()).toEqual(
          Object.keys(n.properties as object).sort(),
        );
      }
      Object.values(n).forEach(visit);
    };
    visit(schema);
  });

  it("keeps only the first three when the model offers more", async () => {
    const model = mockModel({ suggestions: [...three.suggestions, three.suggestions[0]] });
    const result = await suggestCharts(dataset, {
      settings: settingsFor(model),
      budget: freshBudget(),
    });
    expect(result).toHaveLength(3);
  });

  it("treats fewer than three as bad output", async () => {
    const model = mockModel({ suggestions: three.suggestions.slice(0, 2) });
    await expect(
      suggestCharts(dataset, { settings: settingsFor(model), budget: freshBudget() }),
    ).rejects.toBeInstanceOf(AiBadOutputError);
  });

  it("trims an overlong rationale rather than failing the whole set", async () => {
    const long = { ...three.suggestions[0], rationale: "r".repeat(400) };
    const model = mockModel({ suggestions: [long, ...three.suggestions.slice(1)] });
    const [first] = await suggestCharts(dataset, {
      settings: settingsFor(model),
      budget: freshBudget(),
    });
    expect(first.rationale.length).toBeLessThanOrEqual(MAX_RATIONALE_LENGTH);
  });

  it("treats a spec that breaks the contract as bad output", async () => {
    const broken = { ...three.suggestions[0], spec: modelSpec({ title: "x".repeat(121) }) };
    const model = mockModel({ suggestions: [broken, ...three.suggestions.slice(1)] });
    await expect(
      suggestCharts(dataset, { settings: settingsFor(model), budget: freshBudget() }),
    ).rejects.toBeInstanceOf(AiBadOutputError);
  });

  it("treats output that is not the requested structure as bad output", async () => {
    for (const output of ["not json at all", { suggestions: "three" }, { chart: modelSpec() }]) {
      await expect(
        suggestCharts(dataset, { settings: settingsFor(mockModel(output)), budget: freshBudget() }),
      ).rejects.toBeInstanceOf(AiBadOutputError);
    }
  });

  it("reports a provider failure as unavailable, without leaking its message", async () => {
    const error = await suggestCharts(dataset, {
      settings: settingsFor(failingModel(new Error("401 sk-secret-key rejected"))),
      budget: freshBudget(),
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AiUnavailableError);
    expect((error as Error).message).not.toContain("sk-secret-key");
  });

  it("is unavailable without a key, and does not spend budget finding that out", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const budget = freshBudget(5);
    await expect(suggestCharts(dataset, { budget })).rejects.toBeInstanceOf(AiUnavailableError);
    expect(budget.remaining()).toBe(5);
  });

  it("spends one call from the daily budget, and refuses once it is gone", async () => {
    const budget = freshBudget(1);
    const model = mockModel(three);
    await suggestCharts(dataset, { settings: settingsFor(model), budget });
    expect(budget.remaining()).toBe(0);

    await expect(
      suggestCharts(dataset, { settings: settingsFor(model), budget }),
    ).rejects.toBeInstanceOf(AiUnavailableError);
    expect(model.doGenerateCalls).toHaveLength(1);
  });
});
