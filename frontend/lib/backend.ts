import { AwsClient } from "aws4fetch";
import { z } from "zod";
import type { RenderedData } from "@/lib/chart-config";

/** Where the api listens. A Lambda function URL ends in "/", which is dropped. */
export const backendUrl = () =>
  (process.env.BACKEND_INTERNAL_URL || "http://localhost:8080").replace(/\/+$/, "");

/**
 * The one way server code reaches the api, including the browser-facing /api/backend route.
 *
 * On AWS the api's function URL only accepts requests signed with SigV4 by web's own role
 * (BACKEND_AUTH=iam), so every request is signed with the credentials Lambda puts in the
 * function's environment. Under compose the api is a plain HTTP service on the internal network.
 */
export function backendFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = `${backendUrl()}${path}`;
  if (process.env.BACKEND_AUTH !== "iam") return fetch(url, { cache: "no-store", ...init });

  // Built per call: Lambda can rotate the credentials in the environment at any time.
  const signer = new AwsClient({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
    sessionToken: process.env.AWS_SESSION_TOKEN,
    region: process.env.AWS_REGION,
    service: "lambda",
  });
  return signer.fetch(url, { cache: "no-store", ...init });
}

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

/** The dataset does not exist, or has passed its expiry. */
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
 * the dataset expires. Returns null when the id is unknown, which the page shows as not found.
 */
export async function fetchShare(shareId: string): Promise<Share | null> {
  let response: Response;
  try {
    response = await backendFetch(`/shares/${encodeURIComponent(shareId)}`);
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
    response = await backendFetch(`/datasets/${encodeURIComponent(datasetId)}`);
  } catch (cause) {
    throw new BackendError("api unreachable", { cause });
  }
  if (response.status === 404) throw new DatasetNotFoundError();
  if (!response.ok) throw new BackendError(`api answered ${response.status}`);

  const parsed = DatasetDetailSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new BackendError("unexpected dataset detail");
  return parsed.data;
}
