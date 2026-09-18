import type { RenderedData } from "@/lib/chart-config";

/** One entry of GET /gallery. `renderedData` is the RenderResponse shape, verbatim. */
export type GalleryExample = {
  slug: string;
  title: string;
  description: string;
  chartType: string;
  renderedData: RenderedData;
  /** Api-relative, e.g. "/gallery/revenue-by-region/csv". Not a browser URL. */
  csvPath: string;
};

const backendUrl = () => process.env.BACKEND_INTERNAL_URL || "http://localhost:8080";

/**
 * Reads the gallery server-to-server.
 *
 * The /api/backend rewrite is browser-facing and its destination is baked into the
 * routes manifest at build time, so a server render has to address the api directly.
 * Returns null instead of throwing: the landing page degrades to a hero and a notice
 * rather than 500-ing when the api is down.
 */
export async function getGallery(): Promise<GalleryExample[] | null> {
  try {
    const response = await fetch(`${backendUrl()}/gallery`);
    if (!response.ok) return null;
    return (await response.json()) as GalleryExample[];
  } catch {
    return null;
  }
}

/** Turns the api-relative `csvPath` into a URL the browser can follow. */
export const csvHref = (csvPath: string) => `/api/backend${csvPath}`;

/**
 * The badge text for a card. The api reports a stacked bar as `bar` with
 * `renderedData.stacked`, and spells horizontalBar in camel case.
 */
export function chartTypeLabel(example: GalleryExample): string {
  if (example.chartType === "bar" && example.renderedData.stacked) return "stacked bar";
  if (example.chartType === "horizontalBar") return "horizontal bar";
  return example.chartType;
}
