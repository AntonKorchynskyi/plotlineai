import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EXPORT_PADDING,
  exportChartPng,
  exportLayout,
  wrapTitle,
} from "@/lib/analyze/export-png";
import { CHART_INK, CHART_SURFACE } from "@/lib/chart-config";

/** Ten pixels a character, so widths are easy to reason about. */
const measure = (text: string) => text.length * 10;

describe("wrapTitle", () => {
  it("keeps a title that fits on one line", () => {
    expect(wrapTitle("Revenue by region", 400, measure)).toEqual(["Revenue by region"]);
  });

  it("breaks between words once a line would overflow", () => {
    expect(wrapTitle("Total revenue by region and quarter", 200, measure)).toEqual([
      "Total revenue by",
      "region and quarter",
    ]);
  });

  it("gives an overlong word a line of its own instead of splitting it", () => {
    expect(wrapTitle("a supercalifragilistic b", 100, measure)).toEqual([
      "a",
      "supercalifragilistic",
      "b",
    ]);
  });

  it("ignores stray whitespace and draws nothing for a blank title", () => {
    expect(wrapTitle("  Revenue   by region ", 400, measure)).toEqual(["Revenue by region"]);
    expect(wrapTitle("   ", 400, measure)).toEqual([]);
  });
});

describe("exportLayout", () => {
  it("pads the chart on every side and puts the title above it", () => {
    const layout = exportLayout(800, 400, 1, 1);
    expect(layout.padding).toBe(EXPORT_PADDING);
    expect(layout.width).toBe(800 + 2 * EXPORT_PADDING);
    expect(layout.chartTop).toBe(EXPORT_PADDING + layout.lineHeight + 16);
    expect(layout.height).toBe(layout.chartTop + 400 + EXPORT_PADDING);
  });

  it("scales with the device pixel ratio, so a retina export stays proportional", () => {
    const one = exportLayout(800, 400, 1, 1);
    const two = exportLayout(1600, 800, 2, 1);
    expect(two.padding).toBe(one.padding * 2);
    expect(two.titleSize).toBe(one.titleSize * 2);
    expect(two.width).toBe(one.width * 2);
    expect(two.height).toBe(one.height * 2);
  });

  it("grows by a line height for every wrapped title line", () => {
    const one = exportLayout(800, 400, 1, 1);
    const two = exportLayout(800, 400, 1, 2);
    expect(two.chartTop - one.chartTop).toBe(one.lineHeight);
  });

  it("leaves no title band when there is no title", () => {
    expect(exportLayout(800, 400, 1, 0).chartTop).toBe(EXPORT_PADDING);
  });
});

describe("exportChartPng", () => {
  afterEach(() => vi.restoreAllMocks());

  it("paints the surface, then the title, then the chart, and returns a PNG", async () => {
    const calls: string[] = [];
    const context = {
      font: "",
      fillStyle: "",
      textBaseline: "",
      measureText: (text: string) => ({ width: measure(text) }),
      fillRect: (...args: number[]) => calls.push(`fillRect ${context.fillStyle} ${args}`),
      fillText: (text: string, x: number) =>
        calls.push(`fillText ${context.fillStyle} ${text} ${x}`),
      drawImage: (_: unknown, x: number, y: number) => calls.push(`drawImage ${x} ${y}`),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,AAA");
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { load: vi.fn().mockResolvedValue([]) },
    });

    const source = document.createElement("canvas");
    source.width = 800;
    source.height = 400;
    const png = await exportChartPng(
      { canvas: source, currentDevicePixelRatio: 1 },
      { title: "Revenue by region", titleFont: "caprasimo, system-ui" },
    );

    const layout = exportLayout(800, 400, 1, 1);
    expect(png).toBe("data:image/png;base64,AAA");
    expect(calls).toEqual([
      `fillRect ${CHART_SURFACE} 0,0,${layout.width},${layout.height}`,
      `fillText ${CHART_INK} Revenue by region ${EXPORT_PADDING}`,
      `drawImage ${EXPORT_PADDING} ${layout.chartTop}`,
    ]);
    expect(context.font).toBe("26px caprasimo, system-ui");
    expect(document.fonts.load).toHaveBeenCalledWith(context.font, "Revenue by region");
  });
});
