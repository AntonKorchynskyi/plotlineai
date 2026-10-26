import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { AiBadOutputError, AiBudgetRefusedError } from "@/lib/ai/errors";
import { MAX_INSIGHTS, QUERY_ROUNDS, RESEARCH_TIMEOUT, generateInsights } from "@/lib/ai/insights";
import { insightSettings } from "@/lib/ai/provider";
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

  describe("over time", () => {
    const monthly = {
      ...dataset,
      schema: [
        { name: "month", type: "DATE" as const, cardinality: 6, nullCount: 0, format: "yyyy-MM" },
        ...dataset.schema,
      ],
    };
    const byStore: QueryResult = {
      labels: ["2026-04", "2026-05", "2026-06", "2026-07"],
      series: [
        { label: "Campus", data: [14101, 12326, 5811, 4322] },
        { label: "Downtown", data: [16217, 16475, 16841, 17132] },
        { label: "Riverside", data: [7141, 9026, 10600, 12506] },
      ],
      totalGroups: 4,
      totals: [36560, 66665, 39273],
    };
    const overTime = (over: Record<string, unknown> = {}) =>
      modelQuery({ dimension: { column: "month", bucket: "month" }, breakdown: { column: "region" }, sort: null, limit: null, ...over });
    const sentFor = async (query: unknown, answer: QueryResult, data = monthly) => {
      const model = researchThenWrite([query], ["Downtown leads."]);
      await generateInsights(data, { settings: settingsFor(model), budget: freshBudget(), query: answering([answer]) });
      return toolResultsSentOn(model, 1).join();
    };

    it("gives each series' change from the first period to the last, with its share of each", async () => {
      const sent = await sentFor(overTime(), byStore);

      expect(sent).toContain(
        '"change":{"Campus":{"from":{"group":"2026-04","value":14101},"to":{"group":"2026-07","value":4322},"percent":-69.3,"share %":{"from":37.6,"to":12.7}}',
      );
      expect(sent).toContain(
        '"Riverside":{"from":{"group":"2026-04","value":7141},"to":{"group":"2026-07","value":12506},"percent":75.1,"share %":{"from":19.1,"to":36.8}}',
      );
    });

    it("names the series whose share of the period rose and fell most", async () => {
      const sent = await sentFor(overTime(), byStore);

      expect(sent).toContain('"roseMost":{"series":"Riverside","shareFrom":19.1,"shareTo":36.8,"points":17.7}');
      expect(sent).toContain('"fellMost":{"series":"Campus","shareFrom":37.6,"shareTo":12.7,"points":-24.9}');
    });

    it("ranks an average's series by their percentage change, having no shares", async () => {
      const averages = overTime({ measures: [{ column: "revenue", aggregation: "avg", label: null }] });
      const sent = await sentFor(averages, byStore);

      expect(sent).toContain('"roseMost":{"series":"Riverside","percent":75.1}');
      expect(sent).toContain('"fellMost":{"series":"Campus","percent":-69.3}');
      expect(sent).not.toContain("share %");
    });

    it("sets aside a last period far smaller than the rest, as possibly incomplete", async () => {
      const cutShort: QueryResult = {
        ...byStore,
        labels: [...byStore.labels, "2026-08"],
        series: byStore.series.map((s, i) => ({ ...s, data: [...s.data, [500, 900, 700][i]] })),
      };
      const sent = await sentFor(overTime(), cutShort);

      // August holds 2,100 against months of about 35,000: change stops at July.
      expect(sent).toContain('"to":{"group":"2026-07","value":4322}');
      expect(sent).toContain('"partial":"2026-08 holds 2100 against a typical 33960 per period: it may be incomplete');
    });

    it("measures a partial period by a total series of its own, not by every series added up", async () => {
      const withTotal: QueryResult = {
        labels: ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08"],
        series: [
          { label: "all", data: [900, 950, 1000, 980, 200] },
          { label: "cage-free", data: [300, 320, 340, 330, 70] },
          { label: "caged", data: [600, 630, 660, 650, 130] },
        ],
        totalGroups: 5,
        totals: [4030, 1360, 2670],
      };
      const sent = await sentFor(overTime(), withTotal);

      // The total row alone holds what each month holds: 950 a month, not 1,900.
      expect(sent).toContain('"partial":"2026-08 holds 200 against a typical 950 per period');
    });

    it("does not take the small start of a growing series for a partial period", async () => {
      const growing: QueryResult = {
        labels: ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08"],
        series: [{ label: "Riverside", data: [1000, 1400, 2000, 2900, 4100] }],
        totalGroups: 5,
        totals: [11400],
      };
      const sent = await sentFor(overTime(), growing);

      expect(sent).not.toContain('"partial"');
      expect(sent).toContain('"from":{"group":"2026-04","value":1000}');
    });

    it("compares a span of over a year with the same season a later year, not across seasons", async () => {
      const months: QueryResult = {
        labels: ["2024-01", "2024-06", "2024-12", "2025-01", "2025-06", "2025-12"],
        series: [{ label: "sum(revenue)", data: [150, 160, 220, 155, 170, 240] }],
        totalGroups: 6,
        totals: [1095],
      };
      const quarters: QueryResult = { ...months, labels: ["2024-Q1", "2024-Q2", "2024-Q4", "2025-Q1", "2025-Q2", "2025-Q4"] };
      const byQuarter = overTime({ dimension: { column: "month", bucket: "quarter" }, breakdown: null });

      // January against December would be winter against the holidays.
      expect(await sentFor(overTime({ breakdown: null }), months)).toContain(
        '"change":{"sum(revenue)":{"from":{"group":"2024-01","value":150},"to":{"group":"2025-01","value":155},"percent":3.3}}',
      );
      expect(await sentFor(byQuarter, quarters)).toContain('"to":{"group":"2025-Q1","value":155}');
    });

    it("lets an insight quote a change it was given", async () => {
      const model = researchThenWrite([overTime()], ["Campus fell 69.3% while Riverside grew 75.1%."]);

      const insights = await generateInsights(monthly, {
        settings: settingsFor(model),
        budget: freshBudget(),
        query: answering([byStore]),
      });

      expect(insights).toEqual(["Campus fell 69.3% while Riverside grew 75.1%."]);
    });

    it("reads a newest-first answer the right way round", async () => {
      const reversed: QueryResult = {
        ...byStore,
        labels: [...byStore.labels].reverse(),
        series: byStore.series.map((s) => ({ ...s, data: [...s.data].reverse() })),
      };
      const sent = await sentFor(overTime({ sort: { by: "dimension", direction: "desc" } }), reversed);

      expect(sent).toContain('"Campus":{"from":{"group":"2026-04","value":14101},"to":{"group":"2026-07","value":4322}');
    });

    it("treats a column of years as time", async () => {
      const years: QueryResult = {
        labels: ["1998", "2008", "2018"],
        series: [{ label: "sum(revenue)", data: [100, 150, 120] }],
        totalGroups: 3,
        totals: [370],
      };
      const sent = await sentFor(modelQuery({ sort: null, limit: null }), years, dataset);

      expect(sent).toContain('"change":{"sum(revenue)":{"from":{"group":"1998","value":100},"to":{"group":"2018","value":120},"percent":20}}');
      // One series has nobody to be compared with.
      expect(sent).not.toContain("roseMost");
    });

    it("gives no change when the groups are not periods in order", async () => {
      // Categories, periods ranked by a measure, and a cut-off series.
      expect(await sentFor(modelQuery({ sort: null }), byRegion, monthly)).not.toContain('"change"');
      expect(await sentFor(overTime({ sort: { by: "measure", direction: "desc" } }), byStore)).not.toContain('"change"');
      expect(await sentFor(overTime(), { ...byStore, totalGroups: 30 })).not.toContain('"change"');
    });

    it("gives no percentage for a change from zero or across it", async () => {
      const fromZero: QueryResult = {
        labels: ["2026-04", "2026-05"],
        series: [
          { label: "Campus", data: [0, 50] },
          { label: "Downtown", data: [-10, 20] },
        ],
        totalGroups: 2,
        totals: [25, 5],
      };
      const averages = overTime({ measures: [{ column: "revenue", aggregation: "avg", label: null }] });
      const sent = await sentFor(averages, fromZero);

      expect(sent).toContain('"Campus":{"from":{"group":"2026-04","value":0},"to":{"group":"2026-05","value":50}}');
      expect(sent).toContain('"Downtown":{"from":{"group":"2026-04","value":-10},"to":{"group":"2026-05","value":20}}');
      expect(sent).not.toContain("roseMost");
    });
  });

  it("says a sum of rates means nothing, and gives it no shares", async () => {
    const model = researchThenWrite(
      [modelQuery({ measures: [{ column: "loan_debt_pct", aggregation: "sum", label: null }] })],
      ["North America leads."],
    );
    const rates: QueryResult = {
      labels: ["North America", "Europe"],
      series: [{ label: "sum(loan_debt_pct)", data: [0.42, 0.34] }],
      totalGroups: 2,
      totals: [0.76],
    };

    await generateInsights(dataset, { settings: settingsFor(model), budget: freshBudget(), query: answering([rates]) });

    const sent = toolResultsSentOn(model, 1).join();
    expect(sent).toContain("loan_debt_pct reads as a rate, a percentage, an average or a level");
    expect(sent).not.toContain("share %");
  });

  it("adds up a figure per week or per year, a flow rather than a rate", async () => {
    const model = researchThenWrite(
      [modelQuery({ measures: [{ column: "avail_seat_km_per_week", aggregation: "sum", label: null }] })],
      ["North America leads."],
    );
    const flows: QueryResult = {
      labels: ["North America", "Europe"],
      series: [{ label: "sum(avail_seat_km_per_week)", data: [300, 100] }],
      totalGroups: 2,
      totals: [400],
    };

    await generateInsights(dataset, { settings: settingsFor(model), budget: freshBudget(), query: answering([flows]) });

    const sent = toolResultsSentOn(model, 1).join();
    expect(sent).not.toContain("reads as a rate");
    expect(sent).toContain('"sum(avail_seat_km_per_week) share %":75');
  });

  describe("rows that total the others", () => {
    const disasters = {
      ...dataset,
      schema: [
        { name: "Entity", type: "STRING" as const, cardinality: 11, nullCount: 0, format: null },
        { name: "Year", type: "INTEGER" as const, cardinality: 117, nullCount: 0, format: null },
        { name: "Deaths", type: "INTEGER" as const, cardinality: 680, nullCount: 0, format: null },
      ],
      sampleRows: [{ Entity: "Drought", Year: "1900", Deaths: "1261000" }],
    };
    const perYear = modelQuery({
      dimension: { column: "Year", bucket: null },
      measures: [{ column: "Deaths", aggregation: "sum", label: null }],
      sort: null,
      limit: null,
    });
    const byEntity = { ...perYear, breakdown: { column: "Entity" } };
    const yearly: QueryResult = {
      labels: ["1930", "1931"],
      series: [{ label: "sum(Deaths)", data: [200, 800] }],
      totalGroups: 2,
      totals: [1000],
    };
    const split: QueryResult = {
      labels: ["1930", "1931"],
      series: [
        { label: "All natural disasters", data: [100, 400] },
        { label: "Drought", data: [100, 400] },
      ],
      totalGroups: 2,
      totals: [500, 500],
    };

    it("warns that a sum over the whole file counts them twice, when the sample shows one", async () => {
      const model = researchThenWrite([perYear], ["Deaths peaked in 1931."]);
      const withTotal = { ...disasters, sampleRows: [{ Entity: "All natural disasters", Year: "1900", Deaths: "2534720" }] };

      await generateInsights(withTotal, { settings: settingsFor(model), budget: freshBudget(), query: answering([yearly]) });

      const sent = toolResultsSentOn(model, 1).join();
      expect(sent).toContain('Entity holds rows that total the others (such as \\"All natural disasters\\")');
      expect(sent).toContain("counting them twice");
      expect(sent).not.toContain("share %");
    });

    it("warns about an earlier answer once a later one in the same round shows the total row", async () => {
      const model = researchThenWrite([perYear, byEntity], ["Deaths peaked in 1931."]);

      await generateInsights(disasters, {
        settings: settingsFor(model),
        budget: freshBudget(),
        query: answering([yearly, split]),
      });

      // The writing call sees why the per-year finding is unusable, though it was answered
      // first, and none of its figures.
      const findings = sentText(model, 2);
      expect(findings).toContain(
        '"query":{"dimension":{"column":"Year"},"measures":[{"column":"Deaths","aggregation":"sum"}]},"result":{"note":"Entity holds rows that total the others',
      );
      expect(findings).toContain("counting them twice, so its figures are left out.");
      expect(findings).not.toContain('"sum(Deaths)":800');
    });

    it("lets a sum split or filtered on that column stand", async () => {
      const model = researchThenWrite(
        [{ ...perYear, filters: [{ column: "Entity", op: "eq", value: "All natural disasters" }] }],
        ["Deaths peaked in 1931."],
      );
      const withTotal = { ...disasters, sampleRows: [{ Entity: "All natural disasters", Year: "1900", Deaths: "2534720" }] };

      await generateInsights(withTotal, { settings: settingsFor(model), budget: freshBudget(), query: answering([yearly]) });

      expect(toolResultsSentOn(model, 1).join()).not.toContain("counting them twice");
    });

    it("takes a name that starts with All, such as an airline's, for a name, not a total", async () => {
      const model = researchThenWrite([perYear, modelQuery({ dimension: { column: "Entity", bucket: null }, sort: null })], [
        "Deaths peaked in 1931.",
      ]);
      const airline = { ...disasters, sampleRows: [{ Entity: "All Nippon Airways", Year: "1900", Deaths: "12" }] };
      const byName: QueryResult = { ...byRegion, labels: ["All Nippon Airways", "Delta", "KLM", "Qantas", "Lufthansa"] };

      await generateInsights(airline, {
        settings: settingsFor(model),
        budget: freshBudget(),
        query: answering([yearly, byName]),
      });

      const sent = toolResultsSentOn(model, 1).join();
      expect(sent).not.toContain("counting them twice");
      expect(sent).not.toContain("look like totals");
      expect(sent).toContain("share %");
    });
  });

  it("leaves out shares when a breakdown's series include a total of the others", async () => {
    const model = researchThenWrite([modelQuery({ breakdown: { column: "rep" }, sort: null })], ["Floods peaked in 1931."]);
    const withTotal: QueryResult = {
      labels: ["1930", "1931"],
      series: [
        { label: "All natural disasters", data: [100, 400] },
        { label: "Flood", data: [60, 300] },
        { label: "Drought", data: [40, 100] },
      ],
      totalGroups: 2,
      totals: [500, 360, 140],
    };

    await generateInsights(dataset, { settings: settingsFor(model), budget: freshBudget(), query: answering([withTotal]) });

    const sent = toolResultsSentOn(model, 1).join();
    expect(sent).not.toContain("share %");
    expect(sent).toContain('look like totals of other groups');
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

  it("runs at most two of a round's queries at a time, so a burst cannot exhaust the api's concurrency", async () => {
    const model = researchThenWrite(
      Array.from({ length: 6 }, () => modelQuery()),
      ["North America leads with 366,350."],
    );
    let running = 0;
    let most = 0;
    const query = vi.fn(async () => {
      most = Math.max(most, ++running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
      return byRegion;
    });

    await generateInsights(dataset, { settings: settingsFor(model), budget: freshBudget(), query });

    expect(query).toHaveBeenCalledTimes(6);
    expect(most).toBe(2);
  });

  it("drops a fragment that is not a sentence, such as an insight split at a quote", async () => {
    // The model once ended a string at the quote around a column name, splitting one insight.
    const model = researchThenWrite([modelQuery()], [
      "North America leads with 366,350.",
      "The ",
      'region" North America leads with 366,350 in revenue.',
    ]);
    const record = emptyCallRecord();

    const insights = await generateInsights(dataset, {
      settings: settingsFor(model),
      budget: freshBudget(),
      record,
      query: answering([byRegion]),
    });

    expect(insights).toEqual(["North America leads with 366,350."]);
    expect(record.invalidSpecs).toBe(2);
  });

  it("gives the first research step most of its budget, inside web's 60 s with the writing", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    // The first step asks most of the questions at once, so it is the slow one.
    expect(RESEARCH_TIMEOUT.stepMs).toBeGreaterThan(RESEARCH_TIMEOUT.totalMs / 2);
    expect(RESEARCH_TIMEOUT.totalMs + insightSettings().timeout).toBeLessThanOrEqual(55_000);
    vi.unstubAllEnvs();
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
