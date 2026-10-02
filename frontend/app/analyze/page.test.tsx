import { useEffect } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyzeState } from "@/lib/analyze/use-analyze";
import type { ChartSpec } from "@/lib/chart-spec";

const flow = vi.hoisted(() => ({
  upload: vi.fn(),
  choose: vi.fn(),
  describe: vi.fn(),
  share: vi.fn(),
  dropFilters: vi.fn(),
  backToSuggestions: vi.fn(),
  reset: vi.fn(),
  state: { step: "idle" } as AnalyzeState,
  notice: null as unknown,
  shareUrl: null as string | null,
  busy: false,
}));

vi.mock("@/lib/analyze/use-analyze", () => ({ useAnalyze: () => flow }));
vi.mock("@/components/ChartRenderer", () => ({
  default: function MockChartRenderer({
    data,
    height,
    onReady,
  }: {
    data: { title: string };
    height: number;
    onReady?: (chart: { toBase64Image: () => string }) => void;
  }) {
    // The real component hands the Chart.js instance back after drawing, which is what PNG
    // export needs. In an effect, not during render: onReady sets state in the parent.
    useEffect(() => {
      onReady?.({ toBase64Image: () => "data:image/png;base64,AAA" });
    }, [onReady]);
    return <div data-testid="chart" data-title={data.title} data-height={height} />;
  },
}));

const AnalyzePage = (await import("@/app/analyze/page")).default;

const spec: ChartSpec = {
  chartType: "bar",
  title: "Revenue by region",
  dimension: { column: "region" },
  measures: [{ column: "revenue", aggregation: "sum" }],
};

const rendered = {
  chartType: "bar" as const,
  stacked: false,
  title: "Revenue by region",
  labels: ["North"],
  datasets: [{ label: "Revenue", data: [1] }],
};

const dataset = {
  datasetId: "d1",
  rowCount: 12,
  schema: [
    { name: "region", type: "STRING" as const, cardinality: 5, nullCount: 0, format: null },
    { name: "revenue", type: "INTEGER" as const, cardinality: 12, nullCount: 2, format: null },
  ],
};

const suggestions = [
  { rationale: "Ranked bar reads fastest.", spec, rendered },
  { rationale: "Trend over time.", spec: { ...spec, chartType: "line" as const }, rendered },
  { rationale: "Part to whole.", spec: { ...spec, chartType: "pie" as const }, rendered },
];

const show = (state: AnalyzeState, extra: Partial<typeof flow> = {}) => {
  Object.assign(flow, { state, notice: null, shareUrl: null, busy: false }, extra);
  render(<AnalyzePage />);
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("the upload screen", () => {
  it("explains the limits and the three steps", () => {
    show({ step: "idle" });

    expect(screen.getByRole("heading", { name: /start with a csv/i })).toBeInTheDocument();
    expect(screen.getByText(/up to 5 MB and 100,000 rows/i)).toBeInTheDocument();
    for (const step of ["1. Parse", "2. Suggest", "3. Render"]) {
      expect(screen.getByText(step)).toBeInTheDocument();
    }
  });

  it("hands a chosen file to the flow", async () => {
    show({ step: "idle" });
    const file = new File(["a,b\n1,2"], "data.csv", { type: "text/csv" });

    await userEvent.upload(screen.getByLabelText(/csv file/i), file);

    expect(flow.upload).toHaveBeenCalledWith(file);
  });
});

describe("the waiting screens", () => {
  it("names the file while parsing", () => {
    show({ step: "parsing", fileName: "sales.csv" });
    expect(screen.getByRole("heading", { name: /parsing sales\.csv/i })).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows the thinking state without the dataset card", () => {
    show({ step: "thinking", fileName: "sales.csv", dataset });
    expect(screen.getByRole("heading", { name: /reading your columns/i })).toBeInTheDocument();
    expect(screen.queryByText("sales.csv")).not.toBeInTheDocument();
  });
});

describe("the suggestions screen", () => {
  const state: AnalyzeState = {
    step: "suggestions",
    fileName: "revenue.csv",
    dataset,
    suggestions,
  };

  it("summarises what was parsed, including each column", () => {
    show(state);

    expect(screen.getByText("revenue.csv")).toBeInTheDocument();
    expect(screen.getByText("12 rows")).toBeInTheDocument();
    expect(screen.getByText("2 columns")).toBeInTheDocument();
    expect(screen.getByText("2 nulls")).toBeInTheDocument();
    expect(screen.getByText(/region · string · 5 distinct values/)).toBeInTheDocument();
  });

  it("shows three cards, each with its rationale, type and thumbnail", () => {
    show(state);

    const cards = screen.getAllByRole("button", { name: /suggestion \d/i });
    expect(cards).toHaveLength(3);
    expect(within(cards[0]).getByText("Ranked bar reads fastest.")).toBeInTheDocument();
    expect(within(cards[0]).getByText("bar")).toBeInTheDocument();
    expect(within(cards[0]).getByTestId("chart")).toHaveAttribute("data-height", "104");
  });

  it("renders the chosen suggestion", async () => {
    show(state);
    await userEvent.click(screen.getAllByRole("button", { name: /suggestion 2/i })[0]);
    expect(flow.choose).toHaveBeenCalledWith(1);
  });

  it("says a suggestion has no preview rather than dropping it", () => {
    show({ ...state, suggestions: [{ ...suggestions[0], rendered: null }] });
    expect(screen.getByText(/preview unavailable/i)).toBeInTheDocument();
  });

  it("takes a free-text request, and states the cap", async () => {
    show(state);

    const input = screen.getByLabelText(/revenue by region as a doughnut/i);
    await userEvent.type(input, "  sales by month  ");
    await userEvent.click(screen.getByRole("button", { name: "Draw it" }));

    expect(flow.describe).toHaveBeenCalledWith("sales by month");
    expect(screen.getByText(/500 characters max/i)).toBeInTheDocument();
    expect(input).toHaveAttribute("maxlength", "500");
  });

  it("invites a description when the AI returned nothing", () => {
    show(
      { ...state, suggestions: [] },
      { notice: { ok: false, code: "AI_UNAVAILABLE", message: "x", status: 503 } },
    );

    expect(screen.getByText(/no suggestions this time/i)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/unavailable/i);
    // Nothing promises charts that are not there, and the form is the only way forward.
    expect(screen.getByRole("heading", { name: "Describe the chart you want" })).toBeInTheDocument();
    expect(screen.queryByText("Three charts worth a look")).not.toBeInTheDocument();
    expect(screen.queryByText(/pick one/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/or describe it yourself/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Draw it" })).toBeInTheDocument();
  });

  it("offers the suggestions first, and the description as the alternative", () => {
    show(state);
    expect(screen.getByRole("heading", { name: "Three charts worth a look" })).toBeInTheDocument();
    expect(screen.getByText(/pick one to render it/i)).toBeInTheDocument();
    expect(screen.getByText("Or describe it yourself")).toBeInTheDocument();
  });
});

describe("the chart screen", () => {
  const state: AnalyzeState = {
    step: "chart",
    fileName: "revenue.csv",
    dataset,
    suggestions,
    spec,
    rendered,
  };

  it("draws the chart at full height and shows the validated spec", () => {
    show(state);

    expect(screen.getByTestId("chart")).toHaveAttribute("data-height", "400");
    expect(screen.getByText("ChartSpec")).toBeInTheDocument();
    expect(screen.getByText("validated")).toBeInTheDocument();
    expect(screen.getByText(/"chartType": "bar"/)).toBeInTheDocument();
  });

  it("names the file and row count above the chart, with a way back", async () => {
    show(state);

    expect(screen.getByText("revenue.csv · 12 rows aggregated")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /replace file/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /back to suggestions/i }));
    expect(flow.backToSuggestions).toHaveBeenCalled();
  });

  it("refines from the box and from a chip", async () => {
    show(state);

    await userEvent.type(screen.getByLabelText(/make it a doughnut, top five only/i), "top three");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(flow.describe).toHaveBeenCalledWith("top three");

    await userEvent.click(screen.getByRole("button", { name: "Sort ascending" }));
    expect(flow.describe).toHaveBeenCalledWith("Sort ascending");
  });

  it("shares, then shows the link with a copy control", async () => {
    show(state);
    await userEvent.click(screen.getByRole("button", { name: /share/i }));
    expect(flow.share).toHaveBeenCalled();

    show(state, { shareUrl: "http://localhost:3000/s/abc" });
    expect(screen.getByRole("link", { name: "http://localhost:3000/s/abc" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy link/i })).toBeInTheDocument();
  });

  it("downloads a PNG named after the chart", async () => {
    show(state);

    const click = vi.fn();
    const anchor = { href: "", download: "", click } as unknown as HTMLAnchorElement;
    const realCreate = document.createElement.bind(document);
    const create = vi
      .spyOn(document, "createElement")
      .mockImplementation((tag: string) => (tag === "a" ? anchor : realCreate(tag)));

    await userEvent.click(screen.getByRole("button", { name: /download png/i }));

    expect(anchor.download).toBe("revenue-by-region.png");
    expect(anchor.href).toMatch(/^data:image\/png/);
    expect(click).toHaveBeenCalled();
    create.mockRestore();
  });

  it("disables the actions while a request is in flight", () => {
    show(state, { busy: true });
    expect(screen.getByRole("button", { name: /share/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sort ascending" })).toBeDisabled();
  });
});

describe("the outcome screens", () => {
  it("explains an empty result and offers a way back", async () => {
    show({ step: "empty", fileName: "revenue.csv", dataset, suggestions, spec });

    expect(screen.getByText(/nothing left to plot/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Revenue by region" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /drop the filters/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /back to suggestions/i }));
    expect(flow.backToSuggestions).toHaveBeenCalled();
  });

  it("offers to drop the filters when the empty result had some", async () => {
    const filtered = {
      ...spec,
      filters: [{ column: "region", op: "eq" as const, value: "Nowhere" }],
    };
    show({ step: "empty", fileName: "revenue.csv", dataset, suggestions, spec: filtered });

    await userEvent.click(screen.getByRole("button", { name: /drop the filters/i }));
    expect(flow.dropFilters).toHaveBeenCalled();
  });

  it("shows the caps on a rejected file and offers another go", async () => {
    show({
      step: "rejected",
      failure: { ok: false, code: "INVALID_FILE_TYPE", message: "x", status: 415 },
    });

    expect(screen.getByRole("heading", { name: /that file was not a csv/i })).toBeInTheDocument();
    expect(screen.getByText(/5 MB, 100,000 rows, 256 columns/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /pick another file/i }));
    expect(flow.reset).toHaveBeenCalled();
  });

  it.each([
    ["UPLOAD_QUOTA_REACHED", 503, /uploads are paused for today/i],
    ["UPLOAD_NOT_FOUND", 400, /upload did not finish/i],
    ["RATE_LIMITED", 429, /too many uploads/i],
    ["NETWORK", 0, /could not reach the server/i],
    ["UNKNOWN", 502, /went wrong on our side/i],
  ])("does not blame the file for %s, and offers to try again", async (code, status, heading) => {
    show({ step: "rejected", failure: { ok: false, code, message: "x", status } });

    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.queryByText(/5 MB, 100,000 rows, 256 columns/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /pick another file/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(flow.reset).toHaveBeenCalled();
  });
});
