"use client";

import {
  ArcElement,
  BarController,
  BarElement,
  BubbleController,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  DoughnutController,
  PieController,
  PointElement,
  ScatterController,
  Tooltip,
} from "chart.js";
import { Chart } from "react-chartjs-2";
import { CHART_TICK, toChartConfig, type RenderedData } from "@/lib/chart-config";

ChartJS.register(
  BarController,
  LineController,
  PieController,
  DoughnutController,
  ScatterController,
  BubbleController,
  ArcElement,
  BarElement,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Filler,
  Legend,
  Tooltip,
);

// The system's voice, applied once rather than per chart. docs/design-system.md section 5.
ChartJS.defaults.font.family = "Figtree, system-ui, sans-serif";
ChartJS.defaults.color = CHART_TICK;

/** What a caller can do with the drawn chart; `toBase64Image` is the PNG export. */
export type DrawnChart = Pick<ChartJS, "toBase64Image">;

type Props = {
  data: RenderedData;
  /** The well height in pixels. Chart.js fills the wrapper, so it needs an explicit one. */
  height: number;
  className?: string;
  /** A thumbnail: see ChartConfigOptions. */
  compact?: boolean;
  /** Receives the Chart.js instance once drawn, for PNG export on the analyze screen. */
  onReady?: (chart: DrawnChart | null) => void;
};

/**
 * The single component that draws a backend RenderResponse. It adds no styling of its
 * own: every decision lives in toChartConfig, which is why this stays a wrapper.
 */
export default function ChartRenderer({ data, height, className, compact, onReady }: Props) {
  const config = toChartConfig(data, { compact });

  return (
    <div
      className={className}
      style={{ position: "relative", height: `${height}px` }}
      role="img"
      aria-label={data.title}
    >
      <Chart
        type={config.type}
        data={config.data}
        options={config.options}
        ref={(chart) => {
          onReady?.(chart ?? null);
        }}
      />
    </div>
  );
}
