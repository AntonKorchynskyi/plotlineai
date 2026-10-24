import { CHART_INK, CHART_SURFACE } from "@/lib/chart-config";

/**
 * The downloaded PNG: the chart on the surface it sits on in the page, under its title.
 *
 * Chart.js draws on a transparent canvas, so exporting it as is leaves the dark ticks,
 * legend and grid on whatever the image viewer puts behind them; on a black viewer only the
 * coloured marks show. The card around the chart supplies its colour on screen, so the export
 * paints that card instead: the same surface, the same 24px padding (the card's `p-6`), and
 * the heading above it, since a downloaded file has no page around it to say what it shows.
 */

/** All in CSS pixels; scaled by the chart's device pixel ratio so the export stays crisp. */
export const EXPORT_PADDING = 24;
export const EXPORT_TITLE_SIZE = 26;
export const EXPORT_TITLE_LINE_HEIGHT = 1.2;
export const EXPORT_TITLE_GAP = 16;

/** What the export needs from a drawn Chart.js chart. */
export type ExportableChart = { canvas: HTMLCanvasElement; currentDevicePixelRatio: number };

export type ExportLayout = {
  width: number;
  height: number;
  padding: number;
  titleSize: number;
  lineHeight: number;
  chartTop: number;
};

/** Greedy word wrap; a single word wider than the line keeps a line of its own. */
export function wrapTitle(
  title: string,
  maxWidth: number,
  measure: (text: string) => number,
): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of title.trim().split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** The export's size and where its parts go, in device pixels. */
export function exportLayout(
  chartWidth: number,
  chartHeight: number,
  ratio: number,
  titleLines: number,
): ExportLayout {
  const padding = Math.round(EXPORT_PADDING * ratio);
  const titleSize = Math.round(EXPORT_TITLE_SIZE * ratio);
  const lineHeight = Math.round(titleSize * EXPORT_TITLE_LINE_HEIGHT);
  const gap = Math.round(EXPORT_TITLE_GAP * ratio);
  const chartTop = padding + (titleLines > 0 ? titleLines * lineHeight + gap : 0);
  return {
    width: chartWidth + 2 * padding,
    height: chartTop + chartHeight + padding,
    padding,
    titleSize,
    lineHeight,
    chartTop,
  };
}

/**
 * Draws the export and returns it as a PNG data URL.
 * `titleFont` is a CSS font-family list, the one the on-screen heading uses.
 */
export async function exportChartPng(
  chart: ExportableChart,
  { title, titleFont }: { title: string; titleFont: string },
): Promise<string> {
  const source = chart.canvas;
  const ratio = chart.currentDevicePixelRatio;
  const font = `${Math.round(EXPORT_TITLE_SIZE * ratio)}px ${titleFont}`;
  // The heading on screen has already loaded it; this only guards a canvas that would
  // otherwise fall back silently.
  await document.fonts.load(font, title);

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No 2D canvas to draw the export on.");

  context.font = font;
  const lines = wrapTitle(title, source.width, (text) => context.measureText(text).width);
  const layout = exportLayout(source.width, source.height, ratio, lines.length);
  // Resizing a canvas resets its context, font included, so everything is set after.
  canvas.width = layout.width;
  canvas.height = layout.height;

  context.fillStyle = CHART_SURFACE;
  context.fillRect(0, 0, layout.width, layout.height);

  context.font = font;
  context.fillStyle = CHART_INK;
  context.textBaseline = "middle";
  lines.forEach((line, i) => {
    const middle = layout.padding + i * layout.lineHeight + layout.lineHeight / 2;
    context.fillText(line, layout.padding, middle, source.width);
  });

  context.drawImage(source, layout.padding, layout.chartTop);
  return canvas.toDataURL("image/png");
}
