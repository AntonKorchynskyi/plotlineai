import { z } from "zod";
import type { RenderedData } from "@/lib/chart-config";

/**
 * Server-to-server access to the api. The /api/backend rewrite is browser-facing and its
 * destination is baked into the routes manifest at build time, so server code addresses the
 * api directly.
 */
export const backendUrl = () => process.env.BACKEND_INTERNAL_URL || "http://localhost:8080";

const ColumnSchema = z.object({
  name: z.string(),
  type: z.enum(["INTEGER", "DECIMAL", "BOOLEAN", "DATE", "STRING"]),
  cardinality: z.number(),
  nullCount: z.number(),
  format: z.string().nullable(),
});

const DatasetDetailSchema = z.object({
  datasetId: z.string(),
  schema: z.array(ColumnSchema),
  rowCount: z.number(),
  sampleRows: z.array(z.record(z.string(), z.string())),
});

export type ColumnInfo = z.infer<typeof ColumnSchema>;
/** GET /datasets/{id}: the column schema plus up to 20 sample rows. */
export type DatasetDetail = z.infer<typeof DatasetDetailSchema>;

/** The dataset does not exist, or has passed its 7-day expiry. */
export class DatasetNotFoundError extends Error {
  constructor() {
    super("dataset not found");
    this.name = "DatasetNotFoundError";
  }
}

/** The api failed, was unreachable, or answered with something unexpected. */
export class BackendError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "BackendError";
  }
}

const ShareSchema = z.object({
  shareId: z.string(),
  createdAt: z.string(),
  renderedData: z.custom<RenderedData>(() => true),
});

/** GET /shares/{id}: the snapshot rendered when the share was made. */
export type Share = z.infer<typeof ShareSchema>;

/**
 * Reads a share snapshot. It outlives its dataset by design, so this keeps working after
 * the 7-day expiry. Returns null when the id is unknown, which the page shows as not found.
 */
export async function fetchShare(shareId: string): Promise<Share | null> {
  let response: Response;
  try {
    response = await fetch(`${backendUrl()}/shares/${encodeURIComponent(shareId)}`, {
      cache: "no-store",
    });
  } catch (cause) {
    throw new BackendError("api unreachable", { cause });
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new BackendError(`api answered ${response.status}`);

  const parsed = ShareSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new BackendError("unexpected share");
  return parsed.data;
}

export async function fetchDataset(datasetId: string): Promise<DatasetDetail> {
  let response: Response;
  try {
    response = await fetch(`${backendUrl()}/datasets/${encodeURIComponent(datasetId)}`, {
      cache: "no-store",
    });
  } catch (cause) {
    throw new BackendError("api unreachable", { cause });
  }
  if (response.status === 404) throw new DatasetNotFoundError();
  if (!response.ok) throw new BackendError(`api answered ${response.status}`);

  const parsed = DatasetDetailSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new BackendError("unexpected dataset detail");
  return parsed.data;
}
