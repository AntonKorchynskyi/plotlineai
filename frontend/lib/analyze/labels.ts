import type { ChartSpec } from "@/lib/chart-spec";

/** The chart type as a badge reads it: "stacked bar", "horizontal bar", "doughnut". */
export function chartTypeName(spec: Pick<ChartSpec, "chartType" | "stacked">): string {
  if (spec.chartType === "horizontalBar") return "horizontal bar";
  if (spec.stacked && (spec.chartType === "bar" || spec.chartType === "area")) {
    return `stacked ${spec.chartType}`;
  }
  return spec.chartType;
}

/** A filename for a downloaded PNG, from the chart's own title. */
export function pngFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "chart"}.png`;
}
