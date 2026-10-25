import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BackendError,
  DatasetNotFoundError,
  backendFetch,
  backendUrl,
  QueryRefusedError,
  fetchDataset,
  fetchShare,
  fetchStoredInsights,
  queryDataset,
  storeInsights,
  validateSpecs,
  type DatasetDetail,
} from "@/lib/backend";

const ID = "d945b7b2-b960-4811-819f-7797944520ff";

const detail: DatasetDetail = {
  datasetId: ID,
  schema: [
    { name: "date", type: "DATE", cardinality: 22, nullCount: 0, format: "yyyy-MM-dd" },
    { name: "signups", type: "INTEGER", cardinality: 22, nullCount: 0, format: null },
  ],
  rowCount: 22,
  sampleRows: [{ date: "2024-01-08", signups: "142" }],
};

const respond = (body: unknown, status = 200) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("backendUrl", () => {
  it("uses the internal URL when set", () => {
    vi.stubEnv("BACKEND_INTERNAL_URL", "http://api:8080");
    expect(backendUrl()).toBe("http://api:8080");
  });

  it("falls back to localhost", () => {
    vi.stubEnv("BACKEND_INTERNAL_URL", "");
    expect(backendUrl()).toBe("http://localhost:8080");
  });

  it("drops a trailing slash, as a Lambda function URL has one", () => {
    vi.stubEnv("BACKEND_INTERNAL_URL", "https://abc.lambda-url.us-east-1.on.aws/");
    expect(backendUrl()).toBe("https://abc.lambda-url.us-east-1.on.aws");
  });
});

describe("backendFetch", () => {
  const capture = () => {
    const calls: Request[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push(new Request(input, init));
        return new Response("{}");
      }),
    );
    return calls;
  };

  it("sends a plain request when the api needs no signature (compose)", async () => {
    vi.stubEnv("BACKEND_INTERNAL_URL", "http://api:8080");
    vi.stubEnv("BACKEND_AUTH", "");
    const calls = capture();

    await backendFetch("/gallery");

    expect(calls[0].url).toBe("http://api:8080/gallery");
    expect(calls[0].headers.get("authorization")).toBeNull();
  });

  it("signs with the function's AWS credentials when BACKEND_AUTH=iam", async () => {
    vi.stubEnv("BACKEND_INTERNAL_URL", "https://abc.lambda-url.us-east-1.on.aws/");
    vi.stubEnv("BACKEND_AUTH", "iam");
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "AKIDEXAMPLE");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "secret");
    vi.stubEnv("AWS_SESSION_TOKEN", "token");
    const calls = capture();

    await backendFetch("/charts/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    const signed = calls[0];
    expect(signed.url).toBe("https://abc.lambda-url.us-east-1.on.aws/charts/render");
    expect(signed.method).toBe("POST");
    expect(signed.headers.get("authorization")).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/us-east-1\/lambda\/aws4_request/,
    );
    expect(signed.headers.get("x-amz-date")).toMatch(/^\d{8}T\d{6}Z$/);
    expect(signed.headers.get("x-amz-security-token")).toBe("token");
    // The body is part of the signature; Lambda needs no separate payload-hash header.
    expect(await signed.text()).toBe("{}");
  });
});

describe("fetchShare", () => {
  const share = {
    shareId: "s1",
    createdAt: "2026-09-17T10:30:00Z",
    renderedData: { chartType: "bar", stacked: false, title: "T", labels: [], datasets: [] },
  };

  it("reads the stored snapshot", async () => {
    vi.stubEnv("BACKEND_INTERNAL_URL", "http://api:8080");
    respond(share);

    // A share made before insights existed has none.
    await expect(fetchShare("s1")).resolves.toEqual({ ...share, insights: [] });
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("http://api:8080/shares/s1");
  });

  it("reads the insights stored with the share", async () => {
    respond({ ...share, insights: ["North leads."] });
    await expect(fetchShare("s1")).resolves.toEqual({ ...share, insights: ["North leads."] });
  });

  it("returns null for an unknown id, which is a page state and not an error", async () => {
    respond({ error: "NOT_FOUND" }, 404);
    await expect(fetchShare("nope")).resolves.toBeNull();
  });

  it("still fails loudly when the api is broken or unreachable", async () => {
    respond({ error: "INTERNAL" }, 500);
    await expect(fetchShare("s1")).rejects.toBeInstanceOf(BackendError);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    await expect(fetchShare("s1")).rejects.toBeInstanceOf(BackendError);
  });

  it("refuses a response that is not a share", async () => {
    respond({ unexpected: true });
    await expect(fetchShare("s1")).rejects.toBeInstanceOf(BackendError);
  });
});

describe("fetchDataset", () => {
  it("reads the dataset detail server to server", async () => {
    vi.stubEnv("BACKEND_INTERNAL_URL", "http://api:8080");
    respond(detail);

    await expect(fetchDataset(ID)).resolves.toEqual(detail);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(`http://api:8080/datasets/${ID}`);
  });

  it("reports an unknown or expired dataset distinctly", async () => {
    respond({ error: "NOT_FOUND", message: "x" }, 404);
    await expect(fetchDataset(ID)).rejects.toBeInstanceOf(DatasetNotFoundError);
  });

  it("treats any other failure as the backend being unavailable", async () => {
    respond({ error: "INTERNAL" }, 500);
    await expect(fetchDataset(ID)).rejects.toBeInstanceOf(BackendError);
  });

  it("treats an unreachable backend the same way", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    await expect(fetchDataset(ID)).rejects.toBeInstanceOf(BackendError);
  });

  it("refuses a response that is not a dataset detail", async () => {
    respond({ unexpected: true });
    await expect(fetchDataset(ID)).rejects.toBeInstanceOf(BackendError);
  });

  it("encodes the id rather than trusting it into the path", async () => {
    respond(detail);
    await fetchDataset("../gallery").catch(() => undefined);
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain("/datasets/..%2Fgallery");
  });
});

describe("validateSpecs", () => {
  const spec = {
    chartType: "bar" as const,
    title: "Revenue by region",
    dimension: { column: "region" },
    measures: [{ column: "revenue", aggregation: "sum" as const }],
  };

  it("posts the specs and returns each one's result, in order", async () => {
    vi.stubEnv("BACKEND_INTERNAL_URL", "http://api:8080");
    const results = [
      { error: null, empty: true },
      { error: "This aggregation requires a numeric column", empty: false },
    ];
    respond({ results });

    await expect(validateSpecs(ID, [spec, spec])).resolves.toEqual(results);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("http://api:8080/charts/validate");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ datasetId: ID, specs: [spec, spec] });
  });

  it("refuses an answer that does not cover every spec", async () => {
    respond({ results: [{ error: null, empty: false }] });
    await expect(validateSpecs(ID, [spec, spec])).rejects.toBeInstanceOf(BackendError);
  });

  it("reports an expired dataset distinctly and any other failure as unavailable", async () => {
    respond({ error: "NOT_FOUND" }, 404);
    await expect(validateSpecs(ID, [spec])).rejects.toBeInstanceOf(DatasetNotFoundError);
    respond({ error: "INTERNAL" }, 500);
    await expect(validateSpecs(ID, [spec])).rejects.toBeInstanceOf(BackendError);
  });
});

describe("queryDataset", () => {
  const answer = {
    labels: ["north"],
    series: [{ label: "sum(revenue)", data: [40.5] }],
    totalGroups: 3,
    totals: [64.5],
  };

  it("posts the query to the api's internal route and returns the answer", async () => {
    vi.stubEnv("BACKEND_INTERNAL_URL", "http://api:8080");
    respond(answer);
    const query = { measures: [{ column: "revenue", aggregation: "sum" }] };

    await expect(queryDataset(ID, query)).resolves.toEqual(answer);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe(`http://api:8080/internal/datasets/${ID}/query`);
    expect(init).toMatchObject({ method: "POST", body: JSON.stringify(query) });
  });

  it("turns a refused query into its reason, for the AI to correct", async () => {
    respond({ error: "INVALID_CHART_SPEC", message: "The dimension references an unknown column" }, 400);

    const refused = await queryDataset(ID, {}).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(QueryRefusedError);
    expect((refused as QueryRefusedError).reason).toBe("The dimension references an unknown column");
  });

  it("tells a vanished dataset from a broken api", async () => {
    respond({ error: "NOT_FOUND" }, 404);
    await expect(queryDataset(ID, {})).rejects.toBeInstanceOf(DatasetNotFoundError);
    respond({ error: "INTERNAL" }, 500);
    await expect(queryDataset(ID, {})).rejects.toBeInstanceOf(BackendError);
    respond({ unexpected: true });
    await expect(queryDataset(ID, {})).rejects.toBeInstanceOf(BackendError);
  });
});

describe("stored insights", () => {
  it("reads them back, or null when none are stored yet", async () => {
    respond({ insights: ["North leads."] });
    await expect(fetchStoredInsights(ID)).resolves.toEqual(["North leads."]);

    respond({ error: "NOT_FOUND" }, 404);
    await expect(fetchStoredInsights(ID)).resolves.toBeNull();

    respond({ error: "INTERNAL" }, 500);
    await expect(fetchStoredInsights(ID)).rejects.toBeInstanceOf(BackendError);
  });

  it("stores them with a PUT next to the dataset", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));

    await storeInsights(ID, ["North leads."]);

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain(`/internal/datasets/${ID}/insights`);
    expect(init).toMatchObject({ method: "PUT", body: JSON.stringify({ insights: ["North leads."] }) });
  });

  it("fails loudly when storing fails", async () => {
    respond({ error: "NOT_FOUND" }, 404);
    await expect(storeInsights(ID, ["x"])).rejects.toBeInstanceOf(DatasetNotFoundError);
    respond({ error: "INVALID_REQUEST" }, 400);
    await expect(storeInsights(ID, ["x"])).rejects.toBeInstanceOf(BackendError);
  });
});
