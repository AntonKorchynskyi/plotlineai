import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiBadOutputError, AiBudgetRefusedError, AiUnavailableError } from "@/lib/ai/errors";
import type { AiCallRecord } from "@/lib/ai/structured-call";
import { BackendError, DatasetNotFoundError } from "@/lib/backend";
import { dataset } from "@/test/ai";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  fetchDataset: vi.fn(),
  fetchStoredInsights: vi.fn(),
  storeInsights: vi.fn(),
  generateInsights: vi.fn(),
  publishEvent: vi.fn(),
}));

vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  aiRateLimiter: { check: mocks.check },
}));
vi.mock("@/lib/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/backend")>()),
  fetchDataset: mocks.fetchDataset,
  fetchStoredInsights: mocks.fetchStoredInsights,
  storeInsights: mocks.storeInsights,
}));
vi.mock("@/lib/ai/insights", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/insights")>()),
  generateInsights: mocks.generateInsights,
}));
vi.mock("@/lib/events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events")>()),
  publishEvent: mocks.publishEvent,
}));

const { POST } = await import("@/app/api/insights/route");

const ID = dataset.datasetId;
const insights = ["North America leads with 366,350.", "Middle East trails at 47,200."];

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/insights", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

/** Stands in for the AI loop: one budgeted step, then the insights. */
const writes = (result: string[]) => async (_dataset: unknown, deps: { record: AiCallRecord }) => {
  deps.record.attempts = 1;
  return result;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.check.mockReturnValue({ ok: true });
  mocks.fetchDataset.mockResolvedValue(dataset);
  mocks.fetchStoredInsights.mockResolvedValue(null);
  mocks.storeInsights.mockResolvedValue(undefined);
  mocks.generateInsights.mockImplementation(writes(insights));
});

describe("POST /api/insights", () => {
  it("writes the insights, stores them next to the dataset and returns them", async () => {
    const response = await post({ datasetId: ID });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ insights });
    expect(mocks.generateInsights).toHaveBeenCalledWith(dataset, { record: expect.any(Object) });
    expect(mocks.storeInsights).toHaveBeenCalledWith(ID, insights);
    expect(mocks.publishEvent).toHaveBeenCalledWith(
      "ai.called",
      expect.objectContaining({ route: "insights", outcome: "ok", attempts: 1 }),
      expect.anything(),
    );
  });

  it("answers from storage without an AI call, and reports no AI call", async () => {
    mocks.fetchStoredInsights.mockResolvedValue(["Stored earlier."]);

    const response = await post({ datasetId: ID });

    expect(await response.json()).toEqual({ insights: ["Stored earlier."] });
    expect(mocks.generateInsights).not.toHaveBeenCalled();
    expect(mocks.storeInsights).not.toHaveBeenCalled();
    expect(mocks.publishEvent).not.toHaveBeenCalled();
  });

  it("still returns the insights when storing them fails", async () => {
    mocks.storeInsights.mockRejectedValue(new BackendError("api answered 500"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await post({ datasetId: ID });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ insights });
  });

  it("refuses anything but a dataset id", async () => {
    expect((await post({ datasetId: "not-a-uuid" })).status).toBe(400);
    expect((await post({ datasetId: ID, insights: ["forged"] })).status).toBe(400);
    expect(mocks.generateInsights).not.toHaveBeenCalled();
  });

  it("is rate limited with the other AI routes", async () => {
    mocks.check.mockReturnValue({ ok: false, retryAfterSeconds: 30 });

    const response = await post({ datasetId: ID });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
  });

  it("maps failures onto the usual answers", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    mocks.fetchDataset.mockRejectedValueOnce(new DatasetNotFoundError());
    expect((await post({ datasetId: ID })).status).toBe(404);

    mocks.generateInsights.mockRejectedValueOnce(new AiBudgetRefusedError("spent"));
    expect((await post({ datasetId: ID })).status).toBe(503);

    mocks.generateInsights.mockRejectedValueOnce(new AiUnavailableError("down"));
    expect((await post({ datasetId: ID })).status).toBe(503);

    mocks.generateInsights.mockRejectedValueOnce(new AiBadOutputError("nothing survived"));
    expect((await post({ datasetId: ID })).status).toBe(502);
  });
});
