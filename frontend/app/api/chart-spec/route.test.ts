import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiBadOutputError, AiUnavailableError } from "@/lib/ai/errors";
import { DatasetNotFoundError } from "@/lib/backend";
import type { ChartSpec } from "@/lib/chart-spec";
import { dataset } from "@/test/ai";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  fetchDataset: vi.fn(),
  describeChart: vi.fn(),
}));

vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  aiRateLimiter: { check: mocks.check },
}));
vi.mock("@/lib/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/backend")>()),
  fetchDataset: mocks.fetchDataset,
}));
vi.mock("@/lib/ai/chart-spec", () => ({ describeChart: mocks.describeChart }));

const { POST } = await import("@/app/api/chart-spec/route");

const ID = dataset.datasetId;
const spec: ChartSpec = {
  chartType: "bar",
  title: "Revenue by region",
  dimension: { column: "region" },
  measures: [{ column: "revenue", aggregation: "sum" }],
};

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/chart-spec", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.check.mockReturnValue({ ok: true });
  mocks.fetchDataset.mockResolvedValue(dataset);
  mocks.describeChart.mockResolvedValue(spec);
});

describe("POST /api/chart-spec", () => {
  it("returns one spec for a fresh request", async () => {
    const response = await post({ datasetId: ID, instruction: "revenue by region" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ spec });
    expect(mocks.describeChart).toHaveBeenCalledWith(dataset, "revenue by region", undefined, { record: expect.any(Object) });
  });

  it("passes the current spec through when refining", async () => {
    await post({ datasetId: ID, instruction: "make it a doughnut", currentSpec: spec });
    expect(mocks.describeChart).toHaveBeenCalledWith(dataset, "make it a doughnut", spec, { record: expect.any(Object) });
  });

  it("trims the instruction", async () => {
    await post({ datasetId: ID, instruction: "  revenue by region  " });
    expect(mocks.describeChart.mock.calls[0][1]).toBe("revenue by region");
  });

  it.each([
    ["a missing instruction", { datasetId: ID }],
    ["an empty instruction", { datasetId: ID, instruction: "   " }],
    ["an instruction over 500 characters", { datasetId: ID, instruction: "x".repeat(501) }],
    ["a control character", { datasetId: ID, instruction: `bar chart${String.fromCharCode(0)} please` }],
    ["a newline, which is a control character too", { datasetId: ID, instruction: "a\nb" }],
    ["a C1 control character", { datasetId: ID, instruction: `bar${String.fromCharCode(0x85)}chart` }],
    [
      "a current spec that breaks the contract",
      { datasetId: ID, instruction: "x", currentSpec: { ...spec, measures: [] } },
    ],
    ["a bad datasetId", { datasetId: "nope", instruction: "x" }],
  ])("answers 400 for %s", async (_label, body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "INVALID_REQUEST" });
    expect(mocks.describeChart).not.toHaveBeenCalled();
  });

  it("accepts exactly 500 characters", async () => {
    const response = await post({ datasetId: ID, instruction: "x".repeat(500) });
    expect(response.status).toBe(200);
  });

  it("answers 429 when rate limited", async () => {
    mocks.check.mockReturnValue({ ok: false, retryAfterSeconds: 2 });
    const response = await post({ datasetId: ID, instruction: "x" });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("2");
  });

  it("answers 404 when the dataset is gone", async () => {
    mocks.fetchDataset.mockRejectedValue(new DatasetNotFoundError());
    expect((await post({ datasetId: ID, instruction: "x" })).status).toBe(404);
  });

  it("answers 503 and 502 for the two AI failures", async () => {
    mocks.describeChart.mockRejectedValueOnce(new AiUnavailableError("x"));
    expect((await post({ datasetId: ID, instruction: "x" })).status).toBe(503);

    mocks.describeChart.mockRejectedValueOnce(new AiBadOutputError("x"));
    expect((await post({ datasetId: ID, instruction: "x" })).status).toBe(502);
  });
});
