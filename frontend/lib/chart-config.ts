import type { ChartConfiguration } from "chart.js";

/**
 * Maps a backend RenderResponse onto a Chart.js configuration.
 *
 * This is the whole of <ChartRenderer>'s decision making, kept pure so it can be tested
 * without a canvas. Every value here traces to docs/design-system.md section 5; nothing
 * is invented at the call site.
 */

/** The shared categorical palette, in series order. docs/design-system.md section 1. */
export const CHART_PALETTE = [
  "#c67139", // accent 500
  "#8fa073", // accent-2 500
  "#8c491a", // accent 700
  "#aebf92", // accent-2 400
  "#f6a06b", // accent 400
  "#56633f", // accent-2 700
] as const;

export const CHART_GRID = "rgba(32,30,29,0.08)";
export const CHART_TICK = "rgba(32,30,29,0.62)";
/** --color-background, used as the slice border on part-to-whole charts. */
export const CHART_GROUND = "#f5ead8";
/** The accent at 14%, the documented fill under a line. */
export const LINE_FILL = "rgba(198,113,57,0.14)";

/** Bubble radii arrive as raw data values and are normalized into this pixel range. */
export const BUBBLE_RADIUS_MIN = 4;
export const BUBBLE_RADIUS_MAX = 28;

export type ChartTypeName =
  | "bar"
  | "horizontalBar"
  | "line"
  | "area"
  | "pie"
  | "doughnut"
  | "scatter"
  | "bubble";

export type Point = { x: number; y: number };
export type BubblePoint = { x: number; y: number; r: number };
export type SeriesDatum = number | Point | BubblePoint;
export type Series = { label: string; data: SeriesDatum[] };

/** The backend's RenderResponse, which /gallery embeds verbatim as `renderedData`. */
export type RenderedData = {
  chartType: ChartTypeName;
  stacked: boolean;
  title: string;
  labels: string[];
  datasets: Series[];
};

const PART_TO_WHOLE = new Set<ChartTypeName>(["pie", "doughnut"]);
const POINTS = new Set<ChartTypeName>(["scatter", "bubble"]);
const LINES = new Set<ChartTypeName>(["line", "area"]);
/** The validator allows `stacked` on bar and area only. */
const STACKABLE = new Set<ChartTypeName>(["bar", "area"]);

const color = (index: number) => CHART_PALETTE[index % CHART_PALETTE.length];

const axis = (showGrid: boolean, stacked: boolean) => ({
  grid: showGrid ? { color: CHART_GRID } : { display: false },
  border: { display: false },
  ticks: { font: { size: 12 } },
  ...(stacked ? { stacked: true } : {}),
});

/**
 * Bubble `r` is the raw value of the third measure (city density arrives as ~16000), not
 * a pixel radius. Scale it across every series so sizes stay comparable between them.
 */
function normalizeBubbleRadii(datasets: Series[]): Series[] {
  const radii = datasets.flatMap((s) => (s.data as BubblePoint[]).map((p) => p.r));
  if (radii.length === 0) return datasets;

  const min = Math.min(...radii);
  const max = Math.max(...radii);
  const midpoint = (BUBBLE_RADIUS_MIN + BUBBLE_RADIUS_MAX) / 2;
  const scale = (r: number) =>
    max === min
      ? midpoint
      : BUBBLE_RADIUS_MIN +
        ((r - min) / (max - min)) * (BUBBLE_RADIUS_MAX - BUBBLE_RADIUS_MIN);

  return datasets.map((s) => ({
    ...s,
    data: (s.data as BubblePoint[]).map((p) => ({ ...p, r: scale(p.r) })),
  }));
}

export function toChartConfig(data: RenderedData): ChartConfiguration {
  const { chartType, labels } = data;
  const horizontal = chartType === "horizontalBar";
  const partToWhole = PART_TO_WHOLE.has(chartType);
  const points = POINTS.has(chartType);
  const line = LINES.has(chartType);
  const stacked = data.stacked && STACKABLE.has(chartType);

  const type = horizontal ? "bar" : chartType === "area" ? "line" : chartType;
  const series =
    chartType === "bubble" ? normalizeBubbleRadii(data.datasets) : data.datasets;

  const datasets = series.map((s, i) => {
    const base = { label: s.label, data: s.data };

    if (partToWhole) {
      // Slices walk the palette, not the series: a pie has one series and many colours.
      return {
        ...base,
        backgroundColor: labels.map((_, slice) => color(slice)),
        borderColor: CHART_GROUND,
        borderWidth: 3,
      };
    }
    if (line) {
      return {
        ...base,
        borderColor: color(i),
        backgroundColor: LINE_FILL,
        borderWidth: 3,
        tension: 0.38,
        fill: true,
        pointRadius: 3,
        pointBackgroundColor: color(i),
      };
    }
    if (points) {
      return { ...base, backgroundColor: color(i), pointRadius: 5 };
    }
    return {
      ...base,
      backgroundColor: color(i),
      borderRadius: stacked ? 8 : 10,
      maxBarThickness: stacked ? 44 : horizontal ? 26 : 58,
    };
  });

  // Hidden for a single series, because the title already names it. Part-to-whole charts
  // always need one: their categories live in the labels, not in series names.
  const showLegend = partToWhole || series.length > 1;

  const scales = partToWhole
    ? undefined
    : {
        x: axis(points || horizontal, stacked),
        y: {
          ...axis(points || !horizontal, stacked),
          // The render contract carries no axis names, so the series label titles the
          // value axis and the category axis goes untitled.
          ...(points && series[0]
            ? { title: { display: true, text: series[0].label } }
            : {}),
        },
      };

  return {
    type,
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 450 },
      ...(horizontal ? { indexAxis: "y" as const } : {}),
      ...(partToWhole ? { cutout: chartType === "doughnut" ? "58%" : 0 } : {}),
      plugins: {
        legend: showLegend
          ? {
              display: true,
              position: partToWhole ? ("right" as const) : ("bottom" as const),
              labels: {
                usePointStyle: true,
                pointStyle: "circle" as const,
                boxWidth: 10,
                boxHeight: 10,
                padding: 16,
                font: { size: 12 },
              },
            }
          : { display: false },
      },
      ...(scales ? { scales } : {}),
    },
  } as ChartConfiguration;
}
