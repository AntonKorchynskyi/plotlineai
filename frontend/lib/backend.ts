import { z } from "zod";

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
