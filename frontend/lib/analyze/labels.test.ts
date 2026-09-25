import { describe, expect, it } from "vitest";
import { chartTypeName, formatSpec, pngFileName } from "@/lib/analyze/labels";

describe("chartTypeName", () => {
  it("spells out the camel-case and stacked types", () => {
    expect(chartTypeName({ chartType: "horizontalBar" })).toBe("horizontal bar");
    expect(chartTypeName({ chartType: "bar", stacked: true })).toBe("stacked bar");
    expect(chartTypeName({ chartType: "area", stacked: true })).toBe("stacked area");
  });

  it("passes simple types through, and ignores stacked where it does not apply", () => {
    expect(chartTypeName({ chartType: "doughnut" })).toBe("doughnut");
    expect(chartTypeName({ chartType: "line", stacked: true })).toBe("line");
  });
});

describe("pngFileName", () => {
  it("slugs the chart title", () => {
    expect(pngFileName("Revenue by region")).toBe("revenue-by-region.png");
  });

  it("drops punctuation and collapses separators", () => {
    expect(pngFileName("Q1/Q2 sales -- by  category!")).toBe("q1-q2-sales-by-category.png");
  });

  it("falls back when a title slugs to nothing", () => {
    expect(pngFileName("???")).toBe("chart.png");
  });

  it("keeps the name a sane length", () => {
    expect(pngFileName("x".repeat(200)).length).toBeLessThanOrEqual(64);
  });
});

describe("formatSpec", () => {
  it("prints one key per line, small objects inline and object lists one per line", () => {
    const text = formatSpec({
      chartType: "bar",
      title: "Revenue by region",
      dimension: { column: "region" },
      measures: [
        { column: "revenue", aggregation: "sum" },
        { column: "units", aggregation: "avg" },
      ],
      filters: [],
      sort: { by: "measure", direction: "desc" },
      limit: 5,
    });
    expect(text).toBe(
      [
        "{",
        '  "chartType": "bar",',
        '  "title": "Revenue by region",',
        '  "dimension": { "column": "region" },',
        '  "measures": [',
        '    { "column": "revenue", "aggregation": "sum" },',
        '    { "column": "units", "aggregation": "avg" }',
        "  ],",
        '  "filters": [],',
        '  "sort": { "by": "measure", "direction": "desc" },',
        '  "limit": 5',
        "}",
      ].join("\n"),
    );
  });

  it("keeps filter value lists inline and skips undefined keys", () => {
    const text = formatSpec({
      filters: [{ column: "region", op: "in", value: ["EU", "NA"] }],
      breakdown: undefined,
    });
    expect(text).toBe(
      '{\n  "filters": [\n    { "column": "region", "op": "in", "value": ["EU", "NA"] }\n  ]\n}',
    );
  });

  it("stays valid JSON", () => {
    const spec = { chartType: "line", measures: [{ column: "a", aggregation: "count" }] };
    expect(JSON.parse(formatSpec(spec))).toEqual(spec);
  });
});
