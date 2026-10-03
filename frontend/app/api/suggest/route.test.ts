import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiBadOutputError, AiBudgetRefusedError, AiUnavailableError } from "@/lib/ai/errors";
import { BackendError, DatasetNotFoundError } from "@/lib/backend";
import { dataset } from "@/test/ai";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  fetchDataset: vi.fn(),
  suggestCharts: vi.fn(),
  publishEvent: vi.fn(),
}));

vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  aiRateLimiter: { check: mocks.check },
}));
vi.mock("@/lib/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/backend")>()),
  fetchDataset: mocks.fetchDataset,
}));
vi.mock("@/lib/ai/suggest", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/suggest")>()),
  suggestCharts: mocks.suggestCharts,
}));

vi.mock("@/lib/events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events")>()),
  publishEvent: mocks.publishEvent,
}));

const { POST } = await import("@/app/api/suggest/route");

const ID = dataset.datasetId;
const suggestions = [
  {
    rationale: "Ranked bar.",
    spec: {
      chartType: "bar",
      title: "Revenue by region",
      dimension: { column: "region" },
      measures: [{ column: "revenue", aggregation: "sum" }],
    },
  },
];

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request("http://localhost/api/suggest", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.check.mockReturnValue({ ok: true });
  mocks.fetchDataset.mockResolvedValue(dataset);
  mocks.suggestCharts.mockResolvedValue(suggestions);
});

describe("POST /api/suggest", () => {
  it("returns the suggestions for the dataset", async () => {
    const response = await post({ datasetId: ID });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ suggestions });
    expect(mocks.fetchDataset).toHaveBeenCalledWith(ID);
    expect(mocks.suggestCharts).toHaveBeenCalledWith(dataset, { record: expect.any(Object) });
  });

  it("limits by the client address", async () => {
    await post({ datasetId: ID }, { "x-forwarded-for": "203.0.113.7" });
    expect(mocks.check).toHaveBeenCalledWith("203.0.113.7");
  });

  it("answers 429 with Retry-After when the client is over its limit", async () => {
    mocks.check.mockReturnValue({ ok: false, retryAfterSeconds: 4 });
    const response = await post({ datasetId: ID });

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("4");
    expect(await response.json()).toMatchObject({ error: "RATE_LIMITED" });
    expect(mocks.suggestCharts).not.toHaveBeenCalled();
  });

  it.each([
    ["no body", ""],
    ["not JSON", "{ nope"],
    ["no datasetId", {}],
    ["a datasetId that is not a UUID", { datasetId: "../gallery" }],
    ["an unexpected field", { datasetId: ID, extra: 1 }],
  ])("answers 400 for %s", async (_label, body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "INVALID_REQUEST" });
    expect(mocks.suggestCharts).not.toHaveBeenCalled();
  });

  it("answers 413 for an oversized body before parsing it", async () => {
    const response = await post({ datasetId: ID, pad: "x".repeat(40_000) });
    expect(response.status).toBe(413);
    expect(mocks.fetchDataset).not.toHaveBeenCalled();
  });

  it("answers 404 when the dataset is gone", async () => {
    mocks.fetchDataset.mockRejectedValue(new DatasetNotFoundError());
    const response = await post({ datasetId: ID });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "NOT_FOUND" });
  });

  it("answers 503 when the api is down", async () => {
    mocks.fetchDataset.mockRejectedValue(new BackendError("down"));
    const response = await post({ datasetId: ID });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "BACKEND_UNAVAILABLE" });
  });

  it("answers 503 when the AI is unavailable, without echoing why", async () => {
    mocks.suggestCharts.mockRejectedValue(
      new AiUnavailableError("model call failed", { cause: new Error("401 sk-secret") }),
    );
    const response = await post({ datasetId: ID });
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(text)).toMatchObject({ error: "AI_UNAVAILABLE" });
    expect(text).not.toContain("sk-secret");
    expect(text).not.toContain("model call failed");
  });

  it("answers 502 when the model's output was unusable", async () => {
    mocks.suggestCharts.mockRejectedValue(new AiBadOutputError("bad"));
    const response = await post({ datasetId: ID });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "AI_BAD_OUTPUT" });
  });

  it("answers a generic 500 for anything unexpected", async () => {
    mocks.suggestCharts.mockRejectedValue(new TypeError("undefined is not a function"));
    const response = await post({ datasetId: ID });
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toMatchObject({ error: "INTERNAL" });
    expect(text).not.toContain("undefined is not a function");
  });
});

describe("the ai.called event", () => {
  const reported = () => {
    expect(mocks.publishEvent).toHaveBeenCalledTimes(1);
    const [detailType, fields, options] = mocks.publishEvent.mock.calls[0];
    expect(detailType).toBe("ai.called");
    return { fields, options };
  };

  it("reports a successful call with the model and its token counts", async () => {
    mocks.suggestCharts.mockImplementation(async (_dataset, deps) => {
      Object.assign(deps.record, {
        model: "gpt-5-nano",
        inputTokens: 1500,
        outputTokens: 950,
        reasoningTokens: 680,
      });
      return suggestions;
    });
    const lambdaContext = JSON.stringify({ request_id: "0f8fad5b-d9cb-469f-a165-70867728950e" });

    await post({ datasetId: ID }, { "x-amzn-lambda-context": lambdaContext });

    const { fields, options } = reported();
    expect(fields).toEqual({
      route: "suggest",
      model: "gpt-5-nano",
      inputTokens: 1500,
      outputTokens: 950,
      reasoningTokens: 680,
      ms: expect.any(Number),
      outcome: "ok",
    });
    expect(options).toEqual({ requestId: "0f8fad5b-d9cb-469f-a165-70867728950e" });
  });

  it.each([
    ["bad_output", new AiBadOutputError("bad")],
    ["budget_refused", new AiBudgetRefusedError("spent")],
    ["unavailable", new AiUnavailableError("down")],
  ])("reports the %s outcome", async (outcome, failure) => {
    mocks.suggestCharts.mockRejectedValue(failure);
    await post({ datasetId: ID });
    expect(reported().fields).toMatchObject({ route: "suggest", outcome });
  });

  it("reports nothing when no AI call was attempted", async () => {
    mocks.fetchDataset.mockRejectedValue(new DatasetNotFoundError());
    await post({ datasetId: ID });
    mocks.fetchDataset.mockRejectedValue(new BackendError("down"));
    await post({ datasetId: ID });
    expect(mocks.publishEvent).not.toHaveBeenCalled();
  });
});
