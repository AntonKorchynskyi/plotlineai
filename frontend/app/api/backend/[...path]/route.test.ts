import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const upstream = (response: Response) => {
  const calls: Request[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(new Request(input, init));
      return response;
    }),
  );
  return calls;
};

describe("/api/backend/[...path]", () => {
  it("passes a gallery CSV download through byte for byte, headers included", async () => {
    vi.stubEnv("BACKEND_INTERNAL_URL", "http://api:8080");
    const csv = new Uint8Array([0x72, 0x65, 0x67, 0x69, 0x6f, 0x6e, 0x0a, 0xc3, 0xa9]);
    const calls = upstream(
      new Response(csv, {
        status: 200,
        headers: {
          "content-type": "text/csv",
          "content-disposition": 'attachment; filename="revenue-by-region.csv"',
          "x-internal": "not forwarded",
        },
      }),
    );

    const response = await GET(
      new NextRequest("http://localhost:3000/api/backend/gallery/revenue-by-region/csv"),
    );

    expect(calls[0].url).toBe("http://api:8080/gallery/revenue-by-region/csv");
    expect(calls[0].method).toBe("GET");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="revenue-by-region.csv"',
    );
    expect(response.headers.get("x-internal")).toBeNull();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(csv);
  });

  it("forwards a POST with its query and JSON body, and passes the status back", async () => {
    vi.stubEnv("BACKEND_INTERNAL_URL", "http://api:8080");
    const calls = upstream(
      Response.json({ error: "INVALID_CHART_SPEC", message: "bad" }, { status: 400 }),
    );

    const response = await POST(
      new NextRequest("http://localhost:3000/api/backend/charts/render?x=1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"datasetId":"d"}',
      }),
    );

    expect(calls[0].url).toBe("http://api:8080/charts/render?x=1");
    expect(calls[0].headers.get("content-type")).toBe("application/json");
    expect(await calls[0].text()).toBe('{"datasetId":"d"}');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "INVALID_CHART_SPEC", message: "bad" });
  });

  it("refuses a body over 64 KB without calling the api", async () => {
    const calls = upstream(new Response("{}"));

    const response = await POST(
      new NextRequest("http://localhost:3000/api/backend/shares", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "x".repeat(64 * 1024 + 1),
      }),
    );

    expect(response.status).toBe(413);
    expect((await response.json()).error).toBe("PAYLOAD_TOO_LARGE");
    expect(calls).toHaveLength(0);
  });

  it("answers 503 in the api's envelope when the api cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const response = await GET(new NextRequest("http://localhost:3000/api/backend/gallery"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "BACKEND_UNAVAILABLE",
      message: "The data service is unavailable right now.",
    });
  });
});
