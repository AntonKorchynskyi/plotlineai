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

/** One JSON value on a single line, with the spacing a person would type. */
function inlineJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(inlineJson).join(", ")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return "{}";
    return `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${inlineJson(v)}`).join(", ")} }`;
  }
  return JSON.stringify(value);
}

/**
 * The spec as the spec panel prints it: one top-level key per line, small objects inline,
 * and a list of objects one per line. JSON.stringify's two-space layout spends a line on
 * every brace and makes the panel several times taller than the chart it describes.
 */
export function formatSpec(spec: object): string {
  const lines = Object.entries(spec)
    .filter(([, v]) => v !== undefined)
    .map(([key, value]) => {
      const name = `  ${JSON.stringify(key)}: `;
      const objectList =
        Array.isArray(value) &&
        value.length > 0 &&
        value.every((item) => item !== null && typeof item === "object");
      if (!objectList) return name + inlineJson(value);
      return `${name}[\n${value.map((item) => `    ${inlineJson(item)}`).join(",\n")}\n  ]`;
    });
  return lines.length === 0 ? "{}" : `{\n${lines.join(",\n")}\n}`;
}
