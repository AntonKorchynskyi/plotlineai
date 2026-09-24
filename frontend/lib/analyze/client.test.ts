import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  checkFile,
  createShare,
  describeChart,
  renderChart,
  suggest,
  uploadCsv,
} from "@/lib/analyze/client";
import type { ChartSpec } from "@/lib/chart-spec";

const spec: ChartSpec = {
  chartType: "bar",
  title: "Revenue by region",
  dimension: { column: "region" },
  measures: [{ column: "revenue", aggregation: "sum" }],
};

const csv = (name = "data.csv", size = 10) =>
  new File(["x".repeat(size)], name, { type: "text/csv" });

const respond = (body: unknown, init: ResponseInit = {}) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200, ...init })),
  );

afterEach(() => vi.unstubAllGlobals());

describe("checkFile", () => {
  it("accepts a csv within the cap", () => {
    expect(checkFile(csv())).toBeNull();
  });

  it("rejects another extension before any request", () => {
    expect(checkFile(csv("book.xlsx"))?.code).toBe("INVALID_FILE_TYPE");
  });

  it("accepts any capitalisation of the extension", () => {
    expect(checkFile(csv("DATA.CSV"))).toBeNull();
  });

  it("rejects a file over the cap", () => {
    expect(checkFile(csv("big.csv", MAX_UPLOAD_BYTES + 1))?.code).toBe("FILE_TOO_LARGE");
  });

  it("rejects an empty file", () => {
    expect(checkFile(csv("empty.csv", 0))?.code).toBe("MALFORMED_CSV");
  });
});

describe("uploadCsv", () => {
  it("posts the file through the browser proxy and returns the dataset", async () => {
    const detail = { datasetId: "id", schema: [], rowCount: 3 };
    respond(detail, { status: 201 });

    const result = await uploadCsv(csv());

    expect(result).toEqual({ ok: true, value: detail });
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/backend/datasets");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).body).toBeInstanceOf(FormData);
  });

  it("surfaces the api's rejection code", async () => {
    respond({ error: "MALFORMED_CSV", message: "bad" }, { status: 422 });
    const result = await uploadCsv(csv());
    expect(result).toMatchObject({ ok: false, code: "MALFORMED_CSV", status: 422 });
  });

  it("reports a network failure rather than throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const result = await uploadCsv(csv());
    expect(result).toMatchObject({ ok: false, code: "NETWORK" });
  });

  it("reports a non-JSON body as a network-level failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>502</html>", { status: 502 })),
    );
    const result = await uploadCsv(csv());
    expect(result.ok).toBe(false);
  });
});

describe("suggest", () => {
  it("returns the three suggestions", async () => {
    respond({ suggestions: [{ rationale: "r", spec }] });
    const result = await suggest("id");

    expect(result).toEqual({ ok: true, value: [{ rationale: "r", spec }] });
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/suggest");
  });

  it("carries Retry-After through on a 429", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "RATE_LIMITED", message: "slow down" }), {
            status: 429,
            headers: { "Retry-After": "7" },
          }),
      ),
    );
    const result = await suggest("id");
    expect(result).toMatchObject({ ok: false, code: "RATE_LIMITED", retryAfterSeconds: 7 });
  });

  it.each([
    ["AI_UNAVAILABLE", 503],
    ["AI_BAD_OUTPUT", 502],
    ["NOT_FOUND", 404],
  ])("surfaces %s", async (code, status) => {
    respond({ error: code, message: "x" }, { status });
    expect(await suggest("id")).toMatchObject({ ok: false, code, status });
  });
});

describe("describeChart", () => {
  it("sends the instruction, and the current spec when refining", async () => {
    respond({ spec });

    await describeChart("id", "as a doughnut");
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)).toEqual({
      datasetId: "id",
      instruction: "as a doughnut",
    });

    await describeChart("id", "top five", spec);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]?.body as string)).toEqual({
      datasetId: "id",
      instruction: "top five",
      currentSpec: spec,
    });
  });
});

describe("renderChart", () => {
  it("posts to the api and returns the rendered data", async () => {
    const rendered = { chartType: "bar", stacked: false, title: "T", labels: [], datasets: [] };
    respond(rendered);

    expect(await renderChart("id", spec)).toEqual({ ok: true, value: rendered });
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/backend/charts/render");
  });

  it("surfaces a spec the api refuses", async () => {
    respond({ error: "INVALID_CHART_SPEC", message: "unknown column" }, { status: 400 });
    expect(await renderChart("id", spec)).toMatchObject({ code: "INVALID_CHART_SPEC" });
  });
});

describe("createShare", () => {
  it("returns the new share id", async () => {
    respond({ shareId: "abc" }, { status: 201 });

    expect(await createShare("id", spec)).toEqual({ ok: true, value: "abc" });
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/backend/shares");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      datasetId: "id",
      spec,
    });
  });

  it("never sends rendered data, which the api rejects", async () => {
    respond({ shareId: "abc" }, { status: 201 });
    await createShare("id", spec);
    expect(vi.mocked(fetch).mock.calls[0][1]?.body as string).not.toContain("renderedData");
  });
});
