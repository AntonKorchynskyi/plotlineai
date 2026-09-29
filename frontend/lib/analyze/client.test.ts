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
  const presigned = {
    uploadId: "u-1",
    url: "https://plotlineai-data.s3.us-east-1.amazonaws.com/uploads/u-1.csv?X-Amz-Signature=abc",
    headers: { "Content-Type": "text/csv", "Content-Length": "10" },
    expiresInSeconds: 300,
  };
  const detail = { datasetId: "id", schema: [], rowCount: 3 };

  /** Answers each call in turn: presign, PUT, finalize. */
  const steps = (...responses: (Response | Error)[]) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const next = responses.shift();
        if (next instanceof Error) throw next;
        return next ?? new Response(null, { status: 500 });
      }),
    );

  it("asks for an upload URL, PUTs the file to S3, then finalizes the dataset", async () => {
    steps(
      Response.json(presigned, { status: 201 }),
      new Response(null, { status: 200 }),
      Response.json(detail, { status: 201 }),
    );
    const file = csv();

    const result = await uploadCsv(file);

    expect(result).toEqual({ ok: true, value: detail });
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls[0][0]).toBe("/api/backend/datasets/uploads");
    expect(JSON.parse((calls[0][1] as RequestInit).body as string)).toEqual({
      filename: "data.csv",
      contentType: "text/csv",
      size: 10,
    });
    expect(calls[1][0]).toBe(presigned.url);
    const put = calls[1][1] as RequestInit;
    expect(put.method).toBe("PUT");
    expect(put.body).toBe(file);
    // The browser sets Content-Length from the file itself and refuses a scripted one.
    expect(put.headers).toEqual({ "Content-Type": "text/csv" });
    expect(calls[2][0]).toBe("/api/backend/datasets");
    expect(JSON.parse((calls[2][1] as RequestInit).body as string)).toEqual({ uploadId: "u-1" });
  });

  it("stops at a refused presign and never touches S3", async () => {
    steps(Response.json({ error: "UPLOAD_QUOTA_REACHED", message: "x" }, { status: 503 }));
    const result = await uploadCsv(csv());
    expect(result).toMatchObject({ ok: false, code: "UPLOAD_QUOTA_REACHED", status: 503 });
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
  });

  it("reports a PUT that S3 refuses as a network-level failure", async () => {
    steps(Response.json(presigned, { status: 201 }), new Response("<Error/>", { status: 403 }));
    const result = await uploadCsv(csv());
    expect(result).toMatchObject({ ok: false, code: "NETWORK" });
    expect(vi.mocked(fetch).mock.calls).toHaveLength(2);
  });

  it("reports a PUT that never arrives as a network failure", async () => {
    steps(Response.json(presigned, { status: 201 }), new TypeError("Failed to fetch"));
    expect(await uploadCsv(csv())).toMatchObject({ ok: false, code: "NETWORK" });
  });

  it("surfaces the api's rejection code from the finalize step", async () => {
    steps(
      Response.json(presigned, { status: 201 }),
      new Response(null, { status: 200 }),
      Response.json({ error: "MALFORMED_CSV", message: "bad" }, { status: 422 }),
    );
    expect(await uploadCsv(csv())).toMatchObject({ ok: false, code: "MALFORMED_CSV", status: 422 });
  });

  it("reports a network failure rather than throwing", async () => {
    steps(new TypeError("Failed to fetch"));
    expect(await uploadCsv(csv())).toMatchObject({ ok: false, code: "NETWORK" });
  });

  it("reports a non-JSON body as a failure", async () => {
    steps(new Response("<html>502</html>", { status: 502 }));
    expect((await uploadCsv(csv())).ok).toBe(false);
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
