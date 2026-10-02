import { backendFetch } from "@/lib/backend";
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


/**
 * Reads the gallery server-to-server, through backendFetch so it is signed on AWS.
 *
 * A server render cannot use the browser-facing /api/backend route, so it addresses the
 * api directly. Returns null instead of throwing: the landing page degrades to a hero and a
 * notice rather than 500-ing when the api is down. The page cannot say why, so the log does.
 */
export async function getGallery(): Promise<GalleryExample[] | null> {
  try {
    const response = await backendFetch("/gallery");
    if (!response.ok) {
      logFailure(`api answered ${response.status}`);
      return null;
    }
    return (await response.json()) as GalleryExample[];
  } catch (failure) {
    logFailure(failure instanceof Error ? failure.name : typeof failure);
    return null;
  }
}

const logFailure = (error: string) =>
  console.error(JSON.stringify({ event: "gallery_unavailable", error }));

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
