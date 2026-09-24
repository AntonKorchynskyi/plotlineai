import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChartSpec } from "@/lib/chart-spec";
import { useAnalyze } from "@/lib/analyze/use-analyze";

const mocks = vi.hoisted(() => ({
  uploadCsv: vi.fn(),
  suggest: vi.fn(),
  describeChart: vi.fn(),
  renderChart: vi.fn(),
  createShare: vi.fn(),
}));

vi.mock("@/lib/analyze/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analyze/client")>()),
  ...mocks,
}));

const spec = (over: Partial<ChartSpec> = {}): ChartSpec => ({
  chartType: "bar",
  title: "Revenue by region",
  dimension: { column: "region" },
  measures: [{ column: "revenue", aggregation: "sum" }],
  ...over,
});

const dataset = {
  datasetId: "d1",
  rowCount: 12,
  schema: [
    { name: "region", type: "STRING" as const, cardinality: 5, nullCount: 0, format: null },
  ],
};

const rendered = (labels: string[] = ["North"], data: number[] = [1]) => ({
  chartType: "bar" as const,
  stacked: false,
  title: "Revenue by region",
  labels,
  datasets: data.length ? [{ label: "Revenue", data }] : [],
});

const csv = (name = "data.csv") => new File(["a,b\n1,2"], name, { type: "text/csv" });

const ok = <T,>(value: T) => ({ ok: true as const, value });
const fail = (code: string, status = 400, extra: object = {}) => ({
  ok: false as const,
  code,
  message: "x",
  status,
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.uploadCsv.mockResolvedValue(ok(dataset));
  mocks.suggest.mockResolvedValue(
    ok([
      { rationale: "one", spec: spec() },
      { rationale: "two", spec: spec({ chartType: "line" }) },
      { rationale: "three", spec: spec({ chartType: "pie" }) },
    ]),
  );
  mocks.renderChart.mockResolvedValue(ok(rendered()));
  mocks.describeChart.mockResolvedValue(ok(spec({ chartType: "doughnut" })));
  mocks.createShare.mockResolvedValue(ok("share-1"));
});

const upload = async (result: ReturnType<typeof renderHook<ReturnType<typeof useAnalyze>, unknown>>) => {
  await act(async () => {
    await result.result.current.upload(csv());
  });
};

describe("useAnalyze", () => {
  it("starts on the upload screen", () => {
    const { result } = renderHook(() => useAnalyze());
    expect(result.current.state.step).toBe("idle");
  });

  it("walks upload -> suggestions, rendering a thumbnail for each", async () => {
    const hook = renderHook(() => useAnalyze());
    await upload(hook);

    await waitFor(() => expect(hook.result.current.state.step).toBe("suggestions"));
    const state = hook.result.current.state;
    if (state.step !== "suggestions") throw new Error("wrong step");
    expect(state.dataset.rowCount).toBe(12);
    expect(state.fileName).toBe("data.csv");
    expect(state.suggestions).toHaveLength(3);
    expect(state.suggestions[0].rendered).toEqual(rendered());
    expect(mocks.renderChart).toHaveBeenCalledTimes(3);
  });

  it("keeps a suggestion whose thumbnail fails to render", async () => {
    mocks.renderChart.mockResolvedValueOnce(fail("INVALID_CHART_SPEC"));
    const hook = renderHook(() => useAnalyze());
    await upload(hook);

    await waitFor(() => expect(hook.result.current.state.step).toBe("suggestions"));
    const state = hook.result.current.state;
    if (state.step !== "suggestions") throw new Error("wrong step");
    expect(state.suggestions).toHaveLength(3);
    expect(state.suggestions[0].rendered).toBeNull();
  });

  it("rejects a bad file without calling the api", async () => {
    const hook = renderHook(() => useAnalyze());
    await act(async () => {
      await hook.result.current.upload(csv("book.xlsx"));
    });

    expect(hook.result.current.state.step).toBe("rejected");
    expect(mocks.uploadCsv).not.toHaveBeenCalled();
  });

  it("shows the rejection the api reports", async () => {
    mocks.uploadCsv.mockResolvedValue(fail("CAP_EXCEEDED", 422));
    const hook = renderHook(() => useAnalyze());
    await upload(hook);

    const state = hook.result.current.state;
    if (state.step !== "rejected") throw new Error("wrong step");
    expect(state.failure.code).toBe("CAP_EXCEEDED");
  });

  it("renders a chosen suggestion", async () => {
    const hook = renderHook(() => useAnalyze());
    await upload(hook);
    await waitFor(() => expect(hook.result.current.state.step).toBe("suggestions"));

    await act(async () => {
      await hook.result.current.choose(0);
    });

    const state = hook.result.current.state;
    if (state.step !== "chart") throw new Error("wrong step");
    expect(state.spec.chartType).toBe("bar");
    expect(state.rendered.labels).toEqual(["North"]);
  });

  it("goes to the empty screen when a render has no rows left", async () => {
    const hook = renderHook(() => useAnalyze());
    await upload(hook);
    await waitFor(() => expect(hook.result.current.state.step).toBe("suggestions"));

    mocks.renderChart.mockResolvedValue(ok(rendered([], [])));
    await act(async () => {
      await hook.result.current.choose(0);
    });

    expect(hook.result.current.state.step).toBe("empty");
  });

  it("describes a chart from free text", async () => {
    const hook = renderHook(() => useAnalyze());
    await upload(hook);
    await waitFor(() => expect(hook.result.current.state.step).toBe("suggestions"));

    await act(async () => {
      await hook.result.current.describe("as a doughnut");
    });

    expect(mocks.describeChart).toHaveBeenCalledWith("d1", "as a doughnut", undefined);
    const state = hook.result.current.state;
    if (state.step !== "chart") throw new Error("wrong step");
    expect(state.spec.chartType).toBe("doughnut");
  });

  it("passes the current spec when refining from the chart screen", async () => {
    const hook = renderHook(() => useAnalyze());
    await upload(hook);
    await waitFor(() => expect(hook.result.current.state.step).toBe("suggestions"));
    await act(async () => hook.result.current.choose(0));

    await act(async () => {
      await hook.result.current.describe("make it a doughnut");
    });

    expect(mocks.describeChart).toHaveBeenCalledWith(
      "d1",
      "make it a doughnut",
      expect.objectContaining({ chartType: "bar" }),
    );
  });

  it("reports a refusal without losing the chart on screen", async () => {
    const hook = renderHook(() => useAnalyze());
    await upload(hook);
    await waitFor(() => expect(hook.result.current.state.step).toBe("suggestions"));
    await act(async () => hook.result.current.choose(0));

    mocks.describeChart.mockResolvedValue(fail("RATE_LIMITED", 429, { retryAfterSeconds: 9 }));
    await act(async () => {
      await hook.result.current.describe("again");
    });

    expect(hook.result.current.state.step).toBe("chart");
    expect(hook.result.current.notice).toMatchObject({ code: "RATE_LIMITED" });
  });

  it("clears the notice on the next successful action", async () => {
    const hook = renderHook(() => useAnalyze());
    await upload(hook);
    await waitFor(() => expect(hook.result.current.state.step).toBe("suggestions"));

    mocks.describeChart.mockResolvedValueOnce(fail("AI_UNAVAILABLE", 503));
    await act(async () => hook.result.current.describe("one"));
    expect(hook.result.current.notice).not.toBeNull();

    await act(async () => hook.result.current.describe("two"));
    expect(hook.result.current.notice).toBeNull();
  });

  it("shares the chart on screen and keeps the link", async () => {
    const hook = renderHook(() => useAnalyze());
    await upload(hook);
    await waitFor(() => expect(hook.result.current.state.step).toBe("suggestions"));
    await act(async () => hook.result.current.choose(0));

    await act(async () => {
      await hook.result.current.share();
    });

    expect(mocks.createShare).toHaveBeenCalledWith("d1", expect.objectContaining({ chartType: "bar" }));
    expect(hook.result.current.shareUrl).toContain("/s/share-1");
  });

  it("reports an expired dataset when sharing", async () => {
    const hook = renderHook(() => useAnalyze());
    await upload(hook);
    await waitFor(() => expect(hook.result.current.state.step).toBe("suggestions"));
    await act(async () => hook.result.current.choose(0));

    mocks.createShare.mockResolvedValue(fail("NOT_FOUND", 404));
    await act(async () => hook.result.current.share());

    expect(hook.result.current.shareUrl).toBeNull();
    expect(hook.result.current.notice).toMatchObject({ code: "NOT_FOUND" });
  });

  it("goes back to the suggestions already fetched, without asking again", async () => {
    const hook = renderHook(() => useAnalyze());
    await upload(hook);
    await waitFor(() => expect(hook.result.current.state.step).toBe("suggestions"));
    await act(async () => hook.result.current.choose(0));

    act(() => hook.result.current.backToSuggestions());

    expect(hook.result.current.state.step).toBe("suggestions");
    expect(mocks.suggest).toHaveBeenCalledTimes(1);
  });

  it("starts over on reset", async () => {
    const hook = renderHook(() => useAnalyze());
    await upload(hook);
    await waitFor(() => expect(hook.result.current.state.step).toBe("suggestions"));

    act(() => hook.result.current.reset());
    expect(hook.result.current.state.step).toBe("idle");
  });

  it("stays on the suggestions screen when the AI is unavailable during upload", async () => {
    mocks.suggest.mockResolvedValue(fail("AI_UNAVAILABLE", 503));
    const hook = renderHook(() => useAnalyze());
    await upload(hook);

    await waitFor(() => expect(hook.result.current.state.step).toBe("suggestions"));
    const state = hook.result.current.state;
    if (state.step !== "suggestions") throw new Error("wrong step");
    expect(state.suggestions).toEqual([]);
    expect(hook.result.current.notice).toMatchObject({ code: "AI_UNAVAILABLE" });
  });
});
