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
    expect(findings).toContain('"labels":["North America","Asia Pacific"');
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
    expect(sums).toContain('"total":1143850');
    expect(sums).toContain('"sharePercent":[32.03,29.68,24.01,10.15,4.13]');
    // An average's "total" adds nothing up, so it is left out.
    expect(avgs).not.toContain("sharePercent");
    expect(insights).toEqual(["North America is 32% of all revenue, at 366,350."]);
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
