import { afterEach, describe, expect, it, vi } from "vitest";
import gallery from "@/test/fixtures/gallery.json";
import {
  chartTypeLabel,
  csvHref,
  getGallery,
  type GalleryExample,
} from "@/lib/gallery";

const examples = gallery as unknown as GalleryExample[];

const mockFetch = (impl: () => Promise<Response>) => {
  vi.stubGlobal("fetch", vi.fn(impl));
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("getGallery", () => {
  it("returns the six examples in the order the API sent them", async () => {
    mockFetch(async () => new Response(JSON.stringify(examples), { status: 200 }));

    const result = await getGallery();

    expect(result?.map((e) => e.slug)).toEqual([
      "revenue-by-region",
      "monthly-signups",
      "traffic-sources",
      "sales-by-category",
      "price-vs-rating",
      "city-size-vs-density",
    ]);
  });

  it("calls the backend directly, not through the browser-facing rewrite", async () => {
    vi.stubEnv("BACKEND_INTERNAL_URL", "http://api:8080");
    mockFetch(async () => new Response("[]", { status: 200 }));

    await getGallery();

    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("http://api:8080/gallery");
    expect(String(url)).not.toContain("/api/backend");
  });

  it("signs the request on AWS, where the api only accepts web's role", async () => {
    vi.stubEnv("BACKEND_INTERNAL_URL", "https://abc.lambda-url.us-east-1.on.aws/");
    vi.stubEnv("BACKEND_AUTH", "iam");
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "AKIDEXAMPLE");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "secret");
    mockFetch(async () => new Response("[]", { status: 200 }));

    await getGallery();

    const [input, init] = vi.mocked(fetch).mock.calls[0];
    const request = new Request(input, init);
    expect(request.url).toBe("https://abc.lambda-url.us-east-1.on.aws/gallery");
    expect(request.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 /);
  });

  it("falls back to localhost when the internal URL is unset", async () => {
    vi.stubEnv("BACKEND_INTERNAL_URL", "");
    mockFetch(async () => new Response("[]", { status: 200 }));

    await getGallery();

    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("http://localhost:8080/gallery");
  });

  it("returns null on a non-200 rather than throwing, and logs the status", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetch(async () => new Response("nope", { status: 403 }));

    await expect(getGallery()).resolves.toBeNull();

    expect(JSON.parse(log.mock.calls[0][0] as string)).toEqual({
      event: "gallery_unavailable",
      error: "api answered 403",
    });
  });

  it("returns null when the backend is unreachable, and logs the error name only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetch(async () => {
      throw new TypeError("fetch failed: ECONNREFUSED 10.0.0.1");
    });

    await expect(getGallery()).resolves.toBeNull();

    expect(JSON.parse(log.mock.calls[0][0] as string)).toEqual({
      event: "gallery_unavailable",
      error: "TypeError",
    });
  });

  it("returns null when the body is not JSON", async () => {
    mockFetch(async () => new Response("<html>502</html>", { status: 200 }));
    await expect(getGallery()).resolves.toBeNull();
  });
});

describe("csvHref", () => {
  it("prefixes the api-relative path with the browser proxy", () => {
    expect(csvHref("/gallery/revenue-by-region/csv")).toBe(
      "/api/backend/gallery/revenue-by-region/csv",
    );
  });

  it("prefixes every path the fixture carries", () => {
    for (const example of examples) {
      expect(csvHref(example.csvPath)).toBe(`/api/backend${example.csvPath}`);
    }
  });
});

describe("chartTypeLabel", () => {
  const withType = (chartType: string, stacked = false): GalleryExample =>
    ({
      ...examples[0],
      chartType,
      renderedData: { ...examples[0].renderedData, stacked },
    }) as GalleryExample;

  it("reads a stacked bar as such, which the API reports as bar + stacked", () => {
    expect(chartTypeLabel(withType("bar", true))).toBe("stacked bar");
  });

  it("spells out a horizontal bar", () => {
    expect(chartTypeLabel(withType("horizontalBar"))).toBe("horizontal bar");
  });

  it("passes simple types through", () => {
    expect(chartTypeLabel(withType("bar"))).toBe("bar");
    expect(chartTypeLabel(withType("line"))).toBe("line");
    expect(chartTypeLabel(withType("doughnut"))).toBe("doughnut");
    expect(chartTypeLabel(withType("scatter"))).toBe("scatter");
    expect(chartTypeLabel(withType("bubble"))).toBe("bubble");
  });

  it("labels each of the six real examples", () => {
    expect(examples.map(chartTypeLabel)).toEqual([
      "bar",
      "line",
      "doughnut",
      "stacked bar",
      "scatter",
      "bubble",
    ]);
  });
});
