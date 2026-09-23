import { describe, expect, it } from "vitest";
import { chartTypeName, pngFileName } from "@/lib/analyze/labels";

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
