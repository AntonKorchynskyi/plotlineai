import { gunzipSync } from "node:zlib";
import type { SQSEvent } from "aws-lambda";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHandler, toRow, type PutObject } from "./index.js";

const eventBody = (over: Record<string, unknown> = {}, detail: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: "0",
    id: "evt-1",
    "detail-type": "chart.rendered",
    source: "plotlineai.api",
    account: "123456789012",
    time: "2026-10-02T23:59:59Z",
    region: "us-east-1",
    resources: [],
    detail: {
      version: 1,
      occurredAt: "2026-10-02T23:59:58.123Z",
      requestId: "req-1",
      chartType: "bar",
      groups: 2,
      ...detail,
    },
    ...over,
  });

const sqsEvent = (...bodies: string[]): SQSEvent => ({
  Records: bodies.map((body, i) => ({ messageId: `m${i}`, body }) as SQSEvent["Records"][number]),
});

type Written = { key: string; rows: Record<string, unknown>[] };

const recorder = () => {
  const written: Written[] = [];
  const put: PutObject = async (key, body) => {
    const text = gunzipSync(body).toString("utf8");
    expect(text.endsWith("\n")).toBe(true);
    written.push({ key, rows: text.trimEnd().split("\n").map((line) => JSON.parse(line)) });
  };
  return { written, put };
};

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("toRow", () => {
  it("flattens an event into the Redshift columns", () => {
    expect(toRow(eventBody())).toEqual({
      dt: "2026-10-02",
      occurred_at: "2026-10-02T23:59:58.123Z",
      detail_type: "chart.rendered",
      source: "plotlineai.api",
      request_id: "req-1",
      detail: {
        version: 1,
        occurredAt: "2026-10-02T23:59:58.123Z",
        requestId: "req-1",
        chartType: "bar",
        groups: 2,
      },
    });
  });

  it("dates an event by when it happened, in UTC", () => {
    expect(toRow(eventBody({}, { occurredAt: "2026-10-02T22:30:00-04:00" })).dt).toBe("2026-10-03");
  });

  it.each([
    ["not JSON", "{"],
    ["another source", eventBody({ source: "aws.s3" })],
    ["no detail-type", eventBody({ "detail-type": "" })],
    ["no detail", eventBody({ detail: null })],
    ["no occurredAt", eventBody({}, { occurredAt: undefined })],
    ["a bad occurredAt", eventBody({}, { occurredAt: "yesterday" })],
  ])("rejects %s", (_label, body) => {
    expect(() => toRow(body)).toThrow();
  });
});

describe("the handler", () => {
  it("writes one gzipped JSON Lines object per event date", async () => {
    const { written, put } = recorder();
    const result = await createHandler(put)(
      sqsEvent(
        eventBody(),
        eventBody({ "detail-type": "share.created" }),
        eventBody({}, { occurredAt: "2026-10-03T00:00:01Z" }),
      ),
    );

    expect(result).toEqual({ batchItemFailures: [] });
    expect(written).toHaveLength(2);
    const [first, second] = [...written].sort((a, b) => a.key.localeCompare(b.key));
    expect(first.key).toMatch(/^events\/dt=2026-10-02\/[0-9a-f-]{36}\.json\.gz$/);
    expect(first.rows.map((r) => r.detail_type)).toEqual(["chart.rendered", "share.created"]);
    expect(second.key).toMatch(/^events\/dt=2026-10-03\//);
    expect(second.rows).toHaveLength(1);
  });

  it("reports a bad message alone and still archives the rest", async () => {
    const { written, put } = recorder();
    const result = await createHandler(put)(sqsEvent(eventBody(), "not an event", eventBody()));

    expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "m1" }] });
    expect(written).toHaveLength(1);
    expect(written[0].rows).toHaveLength(2);
  });

  it("reports only the messages of a date whose object could not be written", async () => {
    const { written, put } = recorder();
    const failingOnThird: PutObject = (key, body) =>
      key.includes("dt=2026-10-03") ? Promise.reject(new Error("SlowDown")) : put(key, body);

    const result = await createHandler(failingOnThird)(
      sqsEvent(eventBody(), eventBody({}, { occurredAt: "2026-10-03T00:00:01Z" })),
    );

    expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "m1" }] });
    expect(written).toHaveLength(1);
  });

  it("writes nothing for an empty batch", async () => {
    const { written, put } = recorder();
    expect(await createHandler(put)({ Records: [] })).toEqual({ batchItemFailures: [] });
    expect(written).toHaveLength(0);
  });
});
