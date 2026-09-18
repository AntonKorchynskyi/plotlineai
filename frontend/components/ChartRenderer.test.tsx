import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import gallery from "@/test/fixtures/gallery.json";
import ChartRenderer from "@/components/ChartRenderer";
import { toChartConfig, type RenderedData } from "@/lib/chart-config";

/** Chart.js needs a real canvas, so the react binding is captured instead of drawn. */
const captured = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));

vi.mock("react-chartjs-2", () => ({
  Chart: (props: Record<string, unknown>) => {
    captured.props = props;
    return <canvas data-testid="chart-canvas" />;
  },
}));

const fixture = (slug: string): RenderedData => {
  const entry = (gallery as { slug: string; renderedData: RenderedData }[]).find(
    (e) => e.slug === slug,
  );
  if (!entry) throw new Error(`no gallery fixture for ${slug}`);
  return entry.renderedData;
};

describe("<ChartRenderer>", () => {
  it("hands Chart.js exactly what the mapper produced", () => {
    const data = fixture("sales-by-category");
    render(<ChartRenderer data={data} height={240} />);

    const config = toChartConfig(data);
    expect(captured.props?.type).toBe(config.type);
    expect(captured.props?.data).toEqual(config.data);
    expect(captured.props?.options).toEqual(config.options);
  });

  it("renders every gallery chart type without complaint", () => {
    for (const { slug } of gallery) {
      const { unmount } = render(<ChartRenderer data={fixture(slug)} height={240} />);
      expect(screen.getByTestId("chart-canvas")).toBeInTheDocument();
      unmount();
    }
  });

  it("gives the canvas a relative wrapper at the requested height", () => {
    const { container } = render(<ChartRenderer data={fixture("monthly-signups")} height={380} />);

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper).toHaveStyle({ position: "relative", height: "380px" });
  });

  it("describes the chart to assistive technology", () => {
    const data = fixture("revenue-by-region");
    render(<ChartRenderer data={data} height={240} />);

    const figure = screen.getByRole("img");
    expect(figure).toHaveAccessibleName(data.title);
  });

  it("passes a caller className onto the wrapper", () => {
    const { container } = render(
      <ChartRenderer data={fixture("traffic-sources")} height={240} className="chart-well" />,
    );
    expect(container.firstElementChild).toHaveClass("chart-well");
  });
});
