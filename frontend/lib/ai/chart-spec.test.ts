import { describe, expect, it } from "vitest";
import { describeChart } from "@/lib/ai/chart-spec";
import { AiBadOutputError, AiUnavailableError } from "@/lib/ai/errors";
import type { ChartSpec } from "@/lib/chart-spec";
import {
  dataset,
  failingModel,
  freshBudget,
  mockModel,
  modelSpec,
  sentText,
  settingsFor,
} from "@/test/ai";

const current: ChartSpec = {
  chartType: "bar",
  title: "Revenue by region",
  dimension: { column: "region" },
  measures: [{ column: "revenue", aggregation: "sum" }],
};

describe("describeChart", () => {
  it("returns one contract ChartSpec for the request", async () => {
    const model = mockModel(modelSpec({ chartType: "doughnut", sort: null }));
    const spec = await describeChart(dataset, "share of revenue by region", undefined, {
      settings: settingsFor(model),
      budget: freshBudget(),
    });

    expect(spec).toEqual({
      chartType: "doughnut",
      title: "Revenue by region",
      dimension: { column: "region" },
      measures: [{ column: "revenue", aggregation: "sum" }],
    });
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("sends the request and the dataset", async () => {
    const model = mockModel(modelSpec());
    await describeChart(dataset, "revenue by region, biggest first", undefined, {
      settings: settingsFor(model),
      budget: freshBudget(),
    });

    const text = sentText(model);
    expect(text).toContain("revenue by region, biggest first");
    expect(text).toContain("North America");
    expect(text).not.toContain("<current-spec>");
  });

  it("sends the current spec when refining", async () => {
    const model = mockModel(modelSpec({ chartType: "doughnut", sort: null }));
    await describeChart(dataset, "make it a doughnut", current, {
      settings: settingsFor(model),
      budget: freshBudget(),
    });

    const text = sentText(model);
    expect(text).toContain("<current-spec>");
    expect(text).toContain('"title":"Revenue by region"');
    expect(text).toContain("make it a doughnut");
  });

  it("treats a spec that breaks the contract as bad output", async () => {
    const model = mockModel(modelSpec({ measures: [] }));
    await expect(
      describeChart(dataset, "anything", undefined, {
        settings: settingsFor(model),
        budget: freshBudget(),
      }),
    ).rejects.toBeInstanceOf(AiBadOutputError);
  });

  it("treats unparseable output as bad output", async () => {
    await expect(
      describeChart(dataset, "anything", undefined, {
        settings: settingsFor(mockModel("{ not json")),
        budget: freshBudget(),
      }),
    ).rejects.toBeInstanceOf(AiBadOutputError);
  });

  it("reports a provider failure as unavailable", async () => {
    await expect(
      describeChart(dataset, "anything", undefined, {
        settings: settingsFor(failingModel()),
        budget: freshBudget(),
      }),
    ).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it("draws from the same daily budget", async () => {
    const budget = freshBudget(1);
    const model = mockModel(modelSpec());
    await describeChart(dataset, "one", undefined, { settings: settingsFor(model), budget });
    await expect(
      describeChart(dataset, "two", undefined, { settings: settingsFor(model), budget }),
    ).rejects.toBeInstanceOf(AiUnavailableError);
  });
});
