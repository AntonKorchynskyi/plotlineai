import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BackendError,
  DatasetNotFoundError,
  backendUrl,
  fetchDataset,
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
