import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { lambdaRequestId, publishEvent, type EventSender } from "@/lib/events";

const ok: EventSender = async () => ({ FailedEntryCount: 0 });

beforeEach(() => {
  vi.stubEnv("EVENT_BUS_NAME", "plotlineai");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const sentEntry = (send: ReturnType<typeof vi.fn>) => {
  const command = send.mock.calls[0][0] as PutEventsCommand;
  expect(command.input.Entries).toHaveLength(1);
  return command.input.Entries![0];
};

describe("publishEvent", () => {
  it("sends one entry to the bus with the envelope before the fields", async () => {
    const send = vi.fn(ok);
    const before = Date.now();

    await publishEvent("ai.called", { route: "suggest", ms: 12 }, { send, requestId: "req-1" });

    const entry = sentEntry(send);
    expect(entry.EventBusName).toBe("plotlineai");
    expect(entry.Source).toBe("plotlineai.web");
    expect(entry.DetailType).toBe("ai.called");
    const detail = JSON.parse(entry.Detail!);
    expect(Object.keys(detail)).toEqual(["version", "occurredAt", "requestId", "route", "ms"]);
    expect(detail).toMatchObject({ version: 1, requestId: "req-1", route: "suggest", ms: 12 });
    expect(Date.parse(detail.occurredAt)).toBeGreaterThanOrEqual(before - 1000);
  });

  it("makes up a request id when there is none", async () => {
    const send = vi.fn(ok);
    await publishEvent("ai.called", {}, { send });
    expect(JSON.parse(sentEntry(send).Detail!).requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("sends nothing without a bus", async () => {
    vi.stubEnv("EVENT_BUS_NAME", "");
    const send = vi.fn(ok);
    await publishEvent("ai.called", {}, { send });
    expect(send).not.toHaveBeenCalled();
  });

  it("logs and swallows a failed send", async () => {
    const send: EventSender = async () => {
      throw Object.assign(new Error("boom"), { name: "ServiceUnavailable" });
    };
    await expect(publishEvent("ai.called", {}, { send })).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(
      JSON.stringify({ event: "event_publish_failed", detailType: "ai.called", error: "ServiceUnavailable" }),
    );
  });

  it("logs a rejected entry", async () => {
    const send: EventSender = async () => ({
      FailedEntryCount: 1,
      Entries: [{ ErrorCode: "InternalFailure" }],
    });
    await publishEvent("ai.called", {}, { send });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('"error":"InternalFailure"'));
  });

  it("gives up after the timeout instead of holding the request", async () => {
    const send: EventSender = (_command, signal) =>
      new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
    const started = performance.now();

    await publishEvent("ai.called", {}, { send, timeoutMs: 50 });

    expect(performance.now() - started).toBeLessThan(1000);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("event_publish_failed"));
  });
});

describe("lambdaRequestId", () => {
  const withHeader = (value: string) =>
    new Request("http://localhost/", { headers: { "x-amzn-lambda-context": value } });

  it("reads the id Lambda Web Adapter passes on", () => {
    const request = withHeader(JSON.stringify({ request_id: "8f2b6a52-0c3e-4d7e-9f00-1a2b3c4d5e6f" }));
    expect(lambdaRequestId(request)).toBe("8f2b6a52-0c3e-4d7e-9f00-1a2b3c4d5e6f");
  });

  it("ignores a missing or malformed header", () => {
    expect(lambdaRequestId(new Request("http://localhost/"))).toBeUndefined();
    expect(lambdaRequestId(withHeader("not json"))).toBeUndefined();
    expect(lambdaRequestId(withHeader(JSON.stringify({ request_id: "<script>" })))).toBeUndefined();
  });
});
