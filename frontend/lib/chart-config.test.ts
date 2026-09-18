import { describe, expect, it } from "vitest";
import gallery from "@/test/fixtures/gallery.json";
import {
  BUBBLE_RADIUS_MAX,
  BUBBLE_RADIUS_MIN,
  CHART_GRID,
  CHART_GROUND,
  CHART_PALETTE,
  toChartConfig,
  type BubblePoint,
  type RenderedData,
} from "@/lib/chart-config";

/** The six real gallery payloads, keyed by slug, captured from GET /gallery. */
const fixture = (slug: string): RenderedData => {
  const entry = (gallery as { slug: string; renderedData: RenderedData }[]).find(
    (e) => e.slug === slug,
  );
  if (!entry) throw new Error(`no gallery fixture for ${slug}`);
  return entry.renderedData;
};

/** Chart.js config types are a union per chart type; tests read them structurally. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyOf = (value: unknown): any => value;

const dataset = (data: RenderedData, index = 0) =>
  anyOf(toChartConfig(data).data.datasets[index]);
const options = (data: RenderedData) => anyOf(toChartConfig(data).options);

const synthetic = (over: Partial<RenderedData>): RenderedData => ({
  chartType: "bar",
  stacked: false,
  title: "Synthetic",
  labels: ["a", "b"],
  datasets: [{ label: "One", data: [1, 2] }],
  ...over,
});

describe("toChartConfig", () => {
  describe("chart type mapping", () => {
    it("passes a vertical bar through unchanged", () => {
      expect(toChartConfig(fixture("revenue-by-region")).type).toBe("bar");
      expect(options(fixture("revenue-by-region")).indexAxis).toBeUndefined();
    });

    it("maps horizontalBar onto a bar with a y index axis", () => {
      const data = synthetic({ chartType: "horizontalBar" });
      expect(toChartConfig(data).type).toBe("bar");
      expect(options(data).indexAxis).toBe("y");
    });

    it("maps area onto a filled line", () => {
      const data = synthetic({ chartType: "area" });
      expect(toChartConfig(data).type).toBe("line");
      expect(dataset(data).fill).toBe(true);
    });

    it("keeps line, pie, doughnut, scatter and bubble as themselves", () => {
      expect(toChartConfig(fixture("monthly-signups")).type).toBe("line");
      expect(toChartConfig(synthetic({ chartType: "pie" })).type).toBe("pie");
      expect(toChartConfig(fixture("traffic-sources")).type).toBe("doughnut");
      expect(toChartConfig(fixture("price-vs-rating")).type).toBe("scatter");
      expect(toChartConfig(fixture("city-size-vs-density")).type).toBe("bubble");
    });
  });

  describe("palette", () => {
    it("gives a single series the first palette colour", () => {
      expect(dataset(fixture("revenue-by-region")).backgroundColor).toBe(CHART_PALETTE[0]);
    });

    it("walks the palette across multiple series", () => {
      const data = fixture("sales-by-category");
      expect(data.datasets).toHaveLength(3);
      expect(dataset(data, 0).backgroundColor).toBe(CHART_PALETTE[0]);
      expect(dataset(data, 1).backgroundColor).toBe(CHART_PALETTE[1]);
      expect(dataset(data, 2).backgroundColor).toBe(CHART_PALETTE[2]);
    });

    it("cycles the palette past six series", () => {
      const data = synthetic({
        datasets: Array.from({ length: 8 }, (_, i) => ({ label: `s${i}`, data: [i] })),
      });
      expect(dataset(data, 6).backgroundColor).toBe(CHART_PALETTE[0]);
      expect(dataset(data, 7).backgroundColor).toBe(CHART_PALETTE[1]);
    });

    it("colours doughnut slices rather than the series", () => {
      const data = fixture("traffic-sources");
      const colors = dataset(data).backgroundColor;
      expect(colors).toEqual(data.labels.map((_, i) => CHART_PALETTE[i % CHART_PALETTE.length]));
      expect(dataset(data).borderColor).toBe(CHART_GROUND);
      expect(dataset(data).borderWidth).toBe(3);
    });

    it("uses no colour outside the palette", () => {
      const used = new Set<string>();
      for (const slug of gallery.map((e) => e.slug)) {
        const d = dataset(fixture(slug));
        for (const value of [d.backgroundColor, d.borderColor, d.pointBackgroundColor].flat()) {
          if (typeof value === "string") used.add(value);
        }
      }
      const allowed = new Set<string>([
        ...CHART_PALETTE,
        CHART_GROUND,
        "rgba(198,113,57,0.14)", // the accent at 14%, the documented line fill
      ]);
      for (const value of used) expect(allowed).toContain(value);
    });
  });

  describe("bars", () => {
    it("rounds and caps a vertical bar", () => {
      const d = dataset(fixture("revenue-by-region"));
      expect(d.borderRadius).toBe(10);
      expect(d.maxBarThickness).toBe(58);
    });

    it("uses the narrower cap when laid sideways", () => {
      const d = dataset(synthetic({ chartType: "horizontalBar" }));
      expect(d.borderRadius).toBe(10);
      expect(d.maxBarThickness).toBe(26);
    });

    it("tightens the radius and stacks both axes when stacked", () => {
      const data = fixture("sales-by-category");
      expect(data.stacked).toBe(true);
      expect(dataset(data).borderRadius).toBe(8);
      expect(dataset(data).maxBarThickness).toBe(44);
      expect(options(data).scales.x.stacked).toBe(true);
      expect(options(data).scales.y.stacked).toBe(true);
    });

    it("does not stack an unstacked bar", () => {
      const o = options(fixture("revenue-by-region"));
      expect(o.scales.x.stacked).toBeFalsy();
      expect(o.scales.y.stacked).toBeFalsy();
    });
  });

  describe("lines", () => {
    it("applies the documented stroke, tension, points and fill", () => {
      const d = dataset(fixture("monthly-signups"));
      expect(d.borderColor).toBe(CHART_PALETTE[0]);
      expect(d.borderWidth).toBe(3);
      expect(d.tension).toBe(0.38);
      expect(d.pointRadius).toBe(3);
      expect(d.fill).toBe(true);
      expect(d.backgroundColor).toBe("rgba(198,113,57,0.14)");
    });

    it("stacks an area chart but never a plain line", () => {
      expect(options(synthetic({ chartType: "area", stacked: true })).scales.y.stacked).toBe(true);
      expect(options(synthetic({ chartType: "line", stacked: true })).scales.y.stacked).toBeFalsy();
    });
  });

  describe("pie and doughnut", () => {
    it("cuts the doughnut out and leaves the pie solid", () => {
      expect(options(fixture("traffic-sources")).cutout).toBe("58%");
      expect(options(synthetic({ chartType: "pie" })).cutout).toBe(0);
    });

    it("draws no scales", () => {
      expect(options(fixture("traffic-sources")).scales).toBeUndefined();
      expect(options(synthetic({ chartType: "pie" })).scales).toBeUndefined();
    });
  });

  describe("legend", () => {
    it("hides for a single series", () => {
      expect(options(fixture("revenue-by-region")).plugins.legend.display).toBe(false);
      expect(options(fixture("monthly-signups")).plugins.legend.display).toBe(false);
    });

    it("sits at the bottom for a stacked bar", () => {
      const legend = options(fixture("sales-by-category")).plugins.legend;
      expect(legend.display).toBe(true);
      expect(legend.position).toBe("bottom");
    });

    it("sits on the right for part-to-whole charts even with one series", () => {
      for (const data of [fixture("traffic-sources"), synthetic({ chartType: "pie" })]) {
        const legend = options(data).plugins.legend;
        expect(legend.display).toBe(true);
        expect(legend.position).toBe("right");
      }
    });

    it("uses circular swatches", () => {
      const labels = options(fixture("sales-by-category")).plugins.legend.labels;
      expect(labels.usePointStyle).toBe(true);
      expect(labels.pointStyle).toBe("circle");
      expect(labels.boxWidth).toBe(10);
      expect(labels.padding).toBe(16);
    });
  });

  describe("scales", () => {
    it("draws the y grid and no axis border on a category chart", () => {
      const o = options(fixture("revenue-by-region"));
      expect(o.scales.y.grid.color).toBe(CHART_GRID);
      expect(o.scales.y.border.display).toBe(false);
      expect(o.scales.x.grid.display).toBe(false);
      expect(o.scales.y.ticks.font.size).toBe(12);
    });

    it("flips which axis carries the grid when laid sideways", () => {
      const o = options(synthetic({ chartType: "horizontalBar" }));
      expect(o.scales.x.grid.color).toBe(CHART_GRID);
      expect(o.scales.y.grid.display).toBe(false);
    });

    it("draws both grids for point charts", () => {
      const o = options(fixture("price-vs-rating"));
      expect(o.scales.x.grid.color).toBe(CHART_GRID);
      expect(o.scales.y.grid.color).toBe(CHART_GRID);
    });
  });

  describe("point charts", () => {
    it("passes scatter points through untouched", () => {
      const data = fixture("price-vs-rating");
      expect(dataset(data).data).toEqual(data.datasets[0].data);
    });

    it("titles the y axis from the series label and leaves x untitled", () => {
      const o = options(fixture("price-vs-rating"));
      expect(o.scales.y.title).toEqual({ display: true, text: "Rating" });
      expect(o.scales.x.title).toBeUndefined();
    });

    it("normalizes raw bubble radii into the pixel range", () => {
      const data = fixture("city-size-vs-density");
      const raw = data.datasets[0].data as BubblePoint[];
      const drawn = dataset(data).data as BubblePoint[];

      const rawRadii = raw.map((p) => p.r);
      const drawnRadii = drawn.map((p) => p.r);
      expect(Math.min(...rawRadii)).toBeGreaterThan(BUBBLE_RADIUS_MAX); // raw data, not pixels

      expect(Math.min(...drawnRadii)).toBe(BUBBLE_RADIUS_MIN);
      expect(Math.max(...drawnRadii)).toBe(BUBBLE_RADIUS_MAX);
      for (const r of drawnRadii) {
        expect(r).toBeGreaterThanOrEqual(BUBBLE_RADIUS_MIN);
        expect(r).toBeLessThanOrEqual(BUBBLE_RADIUS_MAX);
      }
    });

    it("keeps the relative ordering of bubble radii", () => {
      const data = fixture("city-size-vs-density");
      const raw = (data.datasets[0].data as BubblePoint[]).map((p) => p.r);
      const drawn = (dataset(data).data as BubblePoint[]).map((p) => p.r);
      const order = (xs: number[]) =>
        xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
      expect(order(drawn)).toEqual(order(raw));
    });

    it("leaves bubble x and y untouched", () => {
      const data = fixture("city-size-vs-density");
      const raw = data.datasets[0].data as BubblePoint[];
      const drawn = dataset(data).data as BubblePoint[];
      expect(drawn.map((p) => [p.x, p.y])).toEqual(raw.map((p) => [p.x, p.y]));
    });

    it("puts a single distinct radius at the midpoint", () => {
      const data = synthetic({
        chartType: "bubble",
        labels: [],
        datasets: [
          {
            label: "Only",
            data: [
              { x: 1, y: 1, r: 900 },
              { x: 2, y: 2, r: 900 },
            ],
          },
        ],
      });
      const mid = (BUBBLE_RADIUS_MIN + BUBBLE_RADIUS_MAX) / 2;
      expect((dataset(data).data as BubblePoint[]).map((p) => p.r)).toEqual([mid, mid]);
    });

    it("normalizes across every series, not per series", () => {
      const data = synthetic({
        chartType: "bubble",
        labels: [],
        datasets: [
          { label: "low", data: [{ x: 1, y: 1, r: 10 }] },
          { label: "high", data: [{ x: 2, y: 2, r: 110 }] },
        ],
      });
      expect((dataset(data, 0).data as BubblePoint[])[0].r).toBe(BUBBLE_RADIUS_MIN);
      expect((dataset(data, 1).data as BubblePoint[])[0].r).toBe(BUBBLE_RADIUS_MAX);
    });
  });

  describe("shared options", () => {
    it("is responsive and free of its aspect ratio", () => {
      for (const slug of gallery.map((e) => e.slug)) {
        const o = options(fixture(slug));
        expect(o.responsive).toBe(true);
        expect(o.maintainAspectRatio).toBe(false);
      }
    });

    it("carries the labels through", () => {
      const data = fixture("revenue-by-region");
      expect(toChartConfig(data).data.labels).toEqual(data.labels);
    });

    it("survives an empty payload", () => {
      const data = synthetic({ labels: [], datasets: [] });
      expect(() => toChartConfig(data)).not.toThrow();
      expect(toChartConfig(data).data.datasets).toEqual([]);
    });

    it("survives a bubble payload with no points", () => {
      const data = synthetic({
        chartType: "bubble",
        labels: [],
        datasets: [{ label: "none", data: [] }],
      });
      expect(() => toChartConfig(data)).not.toThrow();
    });
  });
});
