import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { AiBadOutputError, AiBudgetRefusedError } from "@/lib/ai/errors";
import { MAX_INSIGHTS, QUERY_ROUNDS, generateInsights } from "@/lib/ai/insights";
import { INSIGHTS_SYSTEM_PROMPT } from "@/lib/ai/prompt";
import { emptyCallRecord } from "@/lib/ai/structured-call";
import { DatasetNotFoundError, QueryRefusedError, type QueryResult } from "@/lib/backend";
import {
  dataset,
  freshBudget,
  modelQuery,
  sentText,
  settingsFor,
  toolLoopModel,
} from "@/test/ai";

const byRegion: QueryResult = {
  labels: ["North America", "Asia Pacific", "Europe", "Latin America", "Middle East"],
  series: [{ label: "sum(revenue)", data: [366350, 339550, 274650, 116100, 47200] }],
  totalGroups: 5,
  totals: [1143850],
};
const total: QueryResult = {
  labels: ["All rows"],
  series: [{ label: "sum(revenue)", data: [1143850] }],
  totalGroups: 1,
  totals: [1143850],
};

const answering = (results: QueryResult[]) => {
  let call = 0;
  return vi.fn(async () => results[Math.min(call++, results.length - 1)]);
};

/** Research that queries once, a note to end it, then the written insights. */
const researchThenWrite = (queries: unknown[], insights: string[]) =>
  toolLoopModel([{ queries }, { answer: "Enough to write." }, { answer: { insights } }]);

/** What the model was sent back from its tool calls on call number `call`. */
const toolResultsSentOn = (model: ReturnType<typeof toolLoopModel>, call: number) =>
  model.doGenerateCalls[call].prompt
    .filter((m) => m.role === "tool")
    .flatMap((m) => m.content)
    .map((part) => JSON.stringify(part));

describe("generateInsights", () => {
  it("researches the whole file with queries, then writes insights from the findings", async () => {
    const model = researchThenWrite(
      [modelQuery(), modelQuery({ dimension: null, sort: null, limit: null })],
      [
        "North America leads with 366,350 in revenue, 32% of the 1,143,850 total.",
        "Middle East trails at 47,200.",
      ],
    );
    const query = answering([byRegion, total]);
    const budget = freshBudget();
    const record = emptyCallRecord();

    const insights = await generateInsights(dataset, {
      settings: settingsFor(model),
      budget,
      record,
      query,
    });

    expect(insights).toEqual([
      "North America leads with 366,350 in revenue, 32% of the 1,143,850 total.",
      "Middle East trails at 47,200.",
    ]);
    // The model's nulls are dropped before the api sees the query, as for a chart spec.
    expect(query).toHaveBeenNthCalledWith(1, dataset.datasetId, {
      dimension: { column: "region" },
      measures: [{ column: "revenue", aggregation: "sum" }],
      sort: { by: "measure", direction: "desc" },
      limit: 5,
    });
    expect(query).toHaveBeenNthCalledWith(2, dataset.datasetId, {
      measures: [{ column: "revenue", aggregation: "sum" }],
    });
    // Two research steps and the writing call, each from the daily budget.
    expect(budget.remaining()).toBe(97);
    expect(record).toMatchObject({ attempts: 3, inputTokens: 30, outputTokens: 60, invalidSpecs: 0 });
  });

  it("writes in a call of its own with no tools, given every query and its result", async () => {
    const model = researchThenWrite([modelQuery()], ["North America leads with 366,350."]);

    await generateInsights(dataset, {
      settings: settingsFor(model),
      budget: freshBudget(),
      query: answering([byRegion]),
    });

    const writing = model.doGenerateCalls[2];
    expect(writing.tools ?? []).toHaveLength(0);
    expect(writing.responseFormat).toMatchObject({ type: "json", name: "dataset_insights" });
    const findings = sentText(model, 2);
    expect(findings).toContain("<findings>");
    expect(findings).toContain('"groups":[{"group":"North America","sum(revenue)":366350');
    expect(findings).toContain('"query":{"dimension":{"column":"region"}');
  });

  it("gives the model the dataset and the analyst's rules in both calls", async () => {
    const model = researchThenWrite([modelQuery()], ["North America leads with 366,350."]);

    await generateInsights(dataset, {
      settings: settingsFor(model),
      budget: freshBudget(),
      query: answering([byRegion]),
    });

    for (const call of [0, 2]) {
      expect(model.doGenerateCalls[call].prompt[0]).toMatchObject({
        role: "system",
        content: INSIGHTS_SYSTEM_PROMPT,
      });
      expect(sentText(model, call)).toContain('"name":"revenue"');
    }
    expect(model.doGenerateCalls[0].tools?.map((t) => t.name)).toEqual(["query_data"]);
  });

  it("hands the model each group's share of a sum, so it never divides on its own", async () => {
    const model = researchThenWrite(
      [modelQuery(), modelQuery({ measures: [{ column: "revenue", aggregation: "avg", label: null }] })],
      ["North America is 32% of all revenue, at 366,350."],
    );
    const averages: QueryResult = { ...byRegion, series: [{ label: "avg(revenue)", data: [122117, 113183] }] };

    const insights = await generateInsights(dataset, {
      settings: settingsFor(model),
      budget: freshBudget(),
      query: answering([byRegion, averages]),
    });

    const [sums, avgs] = toolResultsSentOn(model, 1);
    expect(sums).toContain('"totals":{"sum(revenue)":1143850}');
    // Beside each group's value, to the one decimal an insight may write.
    expect(sums).toContain('{"group":"North America","sum(revenue)":366350,"sum(revenue) share %":32}');
    expect(sums).toContain('{"group":"Latin America","sum(revenue)":116100,"sum(revenue) share %":10.1}');
    // An average's "total" adds nothing up, so it is left out.
    expect(avgs).not.toContain("share %");
    expect(avgs).not.toContain("totals");
    expect(insights).toEqual(["North America is 32% of all revenue, at 366,350."]);
  });

  it("rounds values the way an insight quotes them, and checks insights against those", async () => {
    const model = researchThenWrite(
      [modelQuery({ measures: [{ column: "revenue", aggregation: "avg", label: null }] })],
      ["North America averages 73.64, against 0.0118 in the Middle East."],
    );
    const averages: QueryResult = {
      labels: ["North America", "Middle East"],
      series: [{ label: "avg(revenue)", data: [73.63886920684212, 0.011764] }],
      totalGroups: 2,
      totals: [73.65],
    };

    const insights = await generateInsights(dataset, {
      settings: settingsFor(model),
      budget: freshBudget(),
      query: answering([averages]),
    });

    const sent = toolResultsSentOn(model, 1).join();
    expect(sent).toContain('{"group":"North America","avg(revenue)":73.64}');
    expect(sent).toContain('{"group":"Middle East","avg(revenue)":0.0118}');
    expect(insights).toEqual(["North America averages 73.64, against 0.0118 in the Middle East."]);
  });

  it("keeps two series apart when a breakdown repeats a label", async () => {
    const model = researchThenWrite([modelQuery()], ["North America leads."]);
    const split: QueryResult = {
      labels: ["North America"],
      series: [
        { label: "group", data: [1] },
        { label: "group", data: [2] },
      ],
      totalGroups: 1,
      totals: [1, 2],
    };

    await generateInsights(dataset, {
      settings: settingsFor(model),
      budget: freshBudget(),
      query: answering([split]),
    });

    expect(toolResultsSentOn(model, 1).join()).toContain('"group":"North America","group (2)":1,');
  });

  it("gives a breakdown's shares within each group, the way a reader takes them", async () => {
    const model = researchThenWrite(
      [modelQuery({ breakdown: { column: "rep" }, sort: null })],
      ["North was 60.6% of January's sales."],
    );
    const split: QueryResult = {
      labels: ["2024-01", "2024-06"],
      series: [
        { label: "North", data: [1000, 2000] },
        { label: "South", data: [650, 550] },
      ],
      totalGroups: 2,
      totals: [3000, 1200],
    };

    const insights = await generateInsights(dataset, {
      settings: settingsFor(model),
      budget: freshBudget(),
      query: answering([split]),
    });

    const sent = toolResultsSentOn(model, 1).join();
    // North's part of January (1,000 of 1,650), not of North's own months (1,000 of 3,000).
    expect(sent).toContain('{"group":"2024-01","North":1000,"North share %":60.6,"South":650,"South share %":39.4}');
    expect(insights).toEqual(["North was 60.6% of January's sales."]);
  });

  it("names each measure's highest and lowest group, so the model never scans for them", async () => {
    const model = researchThenWrite([modelQuery({ sort: null })], ["North America leads with 366,350."]);

    await generateInsights(dataset, {
      settings: settingsFor(model),
      budget: freshBudget(),
      query: answering([byRegion]),
    });

    const sent = toolResultsSentOn(model, 1).join();
    expect(sent).toContain('"highest":{"sum(revenue)":{"group":"North America","value":366350}}');
    expect(sent).toContain('"lowest":{"sum(revenue)":{"group":"Middle East","value":47200}}');
  });

  it("leaves out shares when some groups are totals of the others", async () => {
    const model = researchThenWrite([modelQuery()], ["The World row holds 8,215."]);
    const withWorld: QueryResult = {
      labels: ["World", "High income", "India"],
      series: [{ label: "sum(Value)", data: [8215, 1400, 1463] }],
      totalGroups: 3,
      totals: [11078],
    };

    await generateInsights(dataset, {
      settings: settingsFor(model),
      budget: freshBudget(),
      query: answering([withWorld]),
    });

    const sent = toolResultsSentOn(model, 1).join();
    expect(sent).not.toContain("share %");
    expect(sent).not.toContain('"totals"');
    expect(sent).toContain("look like totals of other groups");
  });

  it("tells the model when an answer was cut off at its limit", async () => {
    const model = researchThenWrite([modelQuery({ limit: null })], ["North America leads with 366,350."]);
    const cut: QueryResult = { ...byRegion, labels: byRegion.labels.slice(0, 2), totalGroups: 66 };

    await generateInsights(dataset, {
      settings: settingsFor(model),
      budget: freshBudget(),
      query: answering([{ ...cut, series: [{ label: "sum(revenue)", data: [366350, 339550] }] }]),
    });

    expect(toolResultsSentOn(model, 1).join()).toContain("Only the first 2 of 66 groups");
  });

  it("writes from the findings it has when research runs out of time", async () => {
    let call = 0;
    const steps = toolLoopModel([{ queries: [modelQuery()] }]);
    const writing = toolLoopModel([{ answer: { insights: ["North America leads with 366,350."] } }]);
    const model = new MockLanguageModelV4({
      doGenerate: async (options) => {
        call++;
        if (call === 1) return steps.doGenerate(options);
        if (call === 2) throw Object.assign(new Error("step timed out"), { name: "TimeoutError" });
        return writing.doGenerate(options);
      },
    });

    const insights = await generateInsights(dataset, {
      settings: settingsFor(model),
      budget: freshBudget(),
      query: answering([byRegion]),
    });

    expect(insights).toEqual(["North America leads with 366,350."]);
    expect(sentText(model, 2)).toContain('"group":"North America"');
  });

  it("accepts a threshold the model chose in a filter", async () => {
    const model = researchThenWrite(
      [modelQuery({ dimension: null, sort: null, filters: [{ column: "revenue", op: "gt", value: 250000 }] })],
      ["Regions above 250,000 in revenue: 3 of 5."],
    );

    const insights = await generateInsights(dataset, {
      settings: settingsFor(model),
      budget: freshBudget(),
      query: answering([{ ...total, series: [{ label: "count", data: [3] }] }]),
    });

    expect(insights).toEqual(["Regions above 250,000 in revenue: 3 of 5."]);
  });

  it("takes out a currency sign the data never names", async () => {
    const model = researchThenWrite([modelQuery()], ["North America leads with $366,350 in revenue."]);

    const insights = await generateInsights(dataset, {
      settings: settingsFor(model),
      budget: freshBudget(),
      query: answering([byRegion]),
    });

    expect(insights).toEqual(["North America leads with 366,350 in revenue."]);
  });

  it("drops an insight with a number the research never produced", async () => {
    const model = researchThenWrite([modelQuery()], [
      "North America leads with 366,350.",
      "Europe has 9,999 customers.",
    ]);
    const record = emptyCallRecord();

    const insights = await generateInsights(dataset, {
      settings: settingsFor(model),
      budget: freshBudget(),
      record,
      query: answering([byRegion]),
    });

    expect(insights).toEqual(["North America leads with 366,350."]);
    expect(record.invalidSpecs).toBe(1);
  });

  it("fails when no insight survives the check", async () => {
    const model = toolLoopModel([{ answer: "No queries needed." }, { answer: { insights: ["Revenue doubled to 2.4 million."] } }]);

    await expect(
      generateInsights(dataset, { settings: settingsFor(model), budget: freshBudget(), query: answering([]) }),
    ).rejects.toBeInstanceOf(AiBadOutputError);
    expect(sentText(model, 1)).toContain("(no queries were run)");
  });

  it("cleans up whitespace, drops repeats and overlong ones, and keeps at most ten", async () => {
    const many = Array.from({ length: 12 }, (_, i) => `Point ${i + 1} of the 12 rows.`);
    const model = toolLoopModel([
      { answer: "No queries needed." },
      {
        answer: {
          insights: ["  The file   has 12 rows. ", "The file has 12 rows.", "x".repeat(241), ...many],
        },
      },
    ]);

    const insights = await generateInsights(dataset, {
      settings: settingsFor(model),
      budget: freshBudget(),
      query: answering([]),
    });

    expect(insights).toHaveLength(MAX_INSIGHTS);
    expect(insights[0]).toBe("The file has 12 rows.");
    expect(insights.filter((i) => i === "The file has 12 rows.")).toHaveLength(1);
  });

  it("hands a refused query's reason back to the model to correct", async () => {
    const model = toolLoopModel([
      { queries: [modelQuery({ dimension: { column: "nope", bucket: null } })] },
      { queries: [modelQuery()] },
      { answer: "Enough." },
      { answer: { insights: ["North America leads with 366,350."] } },
    ]);
    let call = 0;
    const query = vi.fn(async () => {
      if (call++ === 0) throw new QueryRefusedError("The dimension references an unknown column");
      return byRegion;
    });

    await generateInsights(dataset, { settings: settingsFor(model), budget: freshBudget(), query });

    expect(toolResultsSentOn(model, 1).join()).toContain("The dimension references an unknown column");
    // The refused query is no finding: only the answered one reaches the writing call.
    expect(sentText(model, 3)).not.toContain('"column":"nope"');
  });

  it("stops researching after its rounds, then writes", async () => {
    const model = toolLoopModel([
      { queries: [modelQuery()] },
      { queries: [modelQuery()] },
      { queries: [modelQuery()] },
      { answer: { insights: ["North America leads with 366,350."] } },
    ]);

    const insights = await generateInsights(dataset, {
      settings: settingsFor(model),
      budget: freshBudget(),
      query: answering([byRegion]),
    });

    expect(model.doGenerateCalls).toHaveLength(QUERY_ROUNDS + 1);
    expect(insights).toEqual(["North America leads with 366,350."]);
  });

  it("stops when the daily budget runs out between steps", async () => {
    const model = researchThenWrite([modelQuery()], ["North America leads with 366,350."]);

    await expect(
      generateInsights(dataset, {
        settings: settingsFor(model),
        budget: freshBudget(1),
        query: answering([byRegion]),
      }),
    ).rejects.toBeInstanceOf(AiBudgetRefusedError);
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("reports a dataset that expired mid-way rather than insights about nothing", async () => {
    const model = researchThenWrite([modelQuery()], ["The file has 12 rows."]);
    const query = vi.fn(async () => {
      throw new DatasetNotFoundError();
    });

    await expect(
      generateInsights(dataset, { settings: settingsFor(model), budget: freshBudget(), query }),
    ).rejects.toBeInstanceOf(DatasetNotFoundError);
  });
});
