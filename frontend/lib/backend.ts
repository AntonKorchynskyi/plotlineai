import { AwsClient } from "aws4fetch";
import { z } from "zod";
import type { RenderedData } from "@/lib/chart-config";
import type { ChartSpec } from "@/lib/chart-spec";

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
  // A share made before insights existed, or before they were ready, has none.
  insights: z.array(z.string()).default([]),
});

/** GET /shares/{id}: the snapshot rendered when the share was made, and the insights. */
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

const SpecCheckResultSchema = z.object({ error: z.string().nullable(), empty: z.boolean() });
const ValidateResponseSchema = z.object({ results: z.array(SpecCheckResultSchema) });

/** Per spec: the api's reason it would not render (or null), and whether it would draw nothing. */
export type SpecCheckResult = z.infer<typeof SpecCheckResultSchema>;

/**
 * Dry-runs AI-made specs against the dataset before anyone sees them, one result per spec in
 * order. The api's validate route is not on the browser allowlist; only this server-side call
 * reaches it.
 */
export async function validateSpecs(
  datasetId: string,
  specs: ChartSpec[],
): Promise<SpecCheckResult[]> {
  let response: Response;
  try {
    response = await backendFetch("/charts/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ datasetId, specs }),
    });
  } catch (cause) {
    throw new BackendError("api unreachable", { cause });
  }
  if (response.status === 404) throw new DatasetNotFoundError();
  if (!response.ok) throw new BackendError(`api answered ${response.status}`);

  const parsed = ValidateResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success || parsed.data.results.length !== specs.length) {
    throw new BackendError("unexpected validation answer");
  }
  return parsed.data.results;
}

const QueryResultSchema = z.object({
  labels: z.array(z.string()),
  series: z.array(z.object({ label: z.string(), data: z.array(z.number().nullable()) })),
  totalGroups: z.number(),
  totals: z.array(z.number().nullable()),
});

/** One answer to the insights AI's query_data tool, computed over every row by the api. */
export type QueryResult = z.infer<typeof QueryResultSchema>;

/** A question the api refused, with its reason, which goes back to the AI to correct. */
export class QueryRefusedError extends Error {
  constructor(readonly reason: string) {
    super("query refused");
    this.name = "QueryRefusedError";
  }
}

/**
 * Runs one aggregate query over the whole dataset (the api's internal query route, not on the
 * browser allowlist). `query` is a chart spec's building blocks with an optional dimension.
 */
export async function queryDataset(datasetId: string, query: unknown): Promise<QueryResult> {
  let response: Response;
  try {
    response = await backendFetch(`/internal/datasets/${encodeURIComponent(datasetId)}/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(query),
    });
  } catch (cause) {
    throw new BackendError("api unreachable", { cause });
  }
  if (response.status === 404) throw new DatasetNotFoundError();
  if (response.status === 400) {
    const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
    throw new QueryRefusedError(typeof body?.message === "string" ? body.message : "invalid query");
  }
  if (!response.ok) throw new BackendError(`api answered ${response.status}`);

  const parsed = QueryResultSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new BackendError("unexpected query answer");
  return parsed.data;
}

const InsightsSchema = z.object({ insights: z.array(z.string()) });

/** The insights already written for a dataset, or null when there are none yet. */
export async function fetchStoredInsights(datasetId: string): Promise<string[] | null> {
  let response: Response;
  try {
    response = await backendFetch(`/internal/datasets/${encodeURIComponent(datasetId)}/insights`);
  } catch (cause) {
    throw new BackendError("api unreachable", { cause });
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new BackendError(`api answered ${response.status}`);

  const parsed = InsightsSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new BackendError("unexpected insights");
  return parsed.data.insights;
}

/** Stores a dataset's insights next to it, where a share made later copies them from. */
export async function storeInsights(datasetId: string, insights: string[]): Promise<void> {
  let response: Response;
  try {
    response = await backendFetch(`/internal/datasets/${encodeURIComponent(datasetId)}/insights`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ insights }),
    });
  } catch (cause) {
    throw new BackendError("api unreachable", { cause });
  }
  if (response.status === 404) throw new DatasetNotFoundError();
  if (!response.ok) throw new BackendError(`api answered ${response.status}`);
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
