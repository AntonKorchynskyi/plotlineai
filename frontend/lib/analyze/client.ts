import type { RenderedData } from "@/lib/chart-config";
import type { ChartSpec } from "@/lib/chart-spec";
import type { ColumnInfo } from "@/lib/backend";

/**
 * Everything the analyze flow calls from the browser. The browser talks to web, which
 * reaches the api through /api/backend and the AI through the phase 7 routes. The one
 * exception is the CSV itself, which goes straight to S3 on a presigned URL.
 *
 * Nothing here throws. Each call returns a result carrying the api's error code, so the UI
 * can show the copy that code deserves.
 */

/** The api's DATASET_MAX_FILE_BYTES, which the presigned upload URL enforces. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export type Failure = {
  ok: false;
  code: string;
  message: string;
  status: number;
  retryAfterSeconds?: number;
};
export type Result<T> = { ok: true; value: T } | Failure;

export type UploadedDataset = {
  datasetId: string;
  schema: ColumnInfo[];
  rowCount: number;
};

export type Suggestion = { rationale: string; spec: ChartSpec };

const failure = (code: string, message: string, status = 0): Failure => ({
  ok: false,
  code,
  message,
  status,
});

/**
 * The obvious rejections, caught before a request is made. The api re-checks all of this;
 * this only saves the user a round trip on a plainly wrong file.
 */
export function checkFile(file: File): Failure | null {
  if (!file.name.toLowerCase().endsWith(".csv")) {
    return failure("INVALID_FILE_TYPE", "Only .csv files can be read.");
  }
  if (file.size === 0) {
    return failure("MALFORMED_CSV", "That file is empty.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return failure("FILE_TOO_LARGE", "That file is over the 5 MB limit.");
  }
  return null;
}

async function request<T>(url: string, init: RequestInit): Promise<Result<T>> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    return failure("NETWORK", "Could not reach the server.");
  }

  const body = (await response.json().catch(() => null)) as
    | { error?: string; message?: string }
    | null;

  if (!response.ok) {
    const retryAfter = Number(response.headers.get("retry-after"));
    return {
      ok: false,
      code: body?.error ?? "UNKNOWN",
      message: body?.message ?? "Something went wrong.",
      status: response.status,
      ...(Number.isFinite(retryAfter) && retryAfter > 0
        ? { retryAfterSeconds: retryAfter }
        : {}),
    };
  }
  if (body === null) {
    return failure("UNKNOWN", "The server sent an unreadable response.", response.status);
  }
  return { ok: true, value: body as T };
}

const postJson = <T>(url: string, payload: unknown) =>
  request<T>(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

type PresignedUpload = { uploadId: string; url: string; headers: Record<string, string> };

/**
 * Three steps: the api hands out a URL for exactly this file, the file goes straight to S3,
 * and the api then reads and parses it. S3 refuses the PUT if the file is not the size and
 * type the URL was signed for.
 */
export async function uploadCsv(file: File): Promise<Result<UploadedDataset>> {
  const presigned = await postJson<PresignedUpload>("/api/backend/datasets/uploads", {
    filename: file.name,
    contentType: "text/csv",
    size: file.size,
  });
  if (!presigned.ok) return presigned;

  // Content-Length is signed too, but a browser refuses to set it by hand; it sends the
  // file's own size, which is what was declared.
  const headers = Object.fromEntries(
    Object.entries(presigned.value.headers).filter(([name]) => name.toLowerCase() !== "content-length"),
  );
  try {
    const put = await fetch(presigned.value.url, { method: "PUT", headers, body: file });
    if (!put.ok) return failure("NETWORK", "The file could not be uploaded.", put.status);
  } catch {
    return failure("NETWORK", "Could not reach the server.");
  }

  return postJson<UploadedDataset>("/api/backend/datasets", { uploadId: presigned.value.uploadId });
}

export async function suggest(datasetId: string): Promise<Result<Suggestion[]>> {
  const result = await postJson<{ suggestions: Suggestion[] }>("/api/suggest", { datasetId });
  return result.ok ? { ok: true, value: result.value.suggestions } : result;
}

export async function describeChart(
  datasetId: string,
  instruction: string,
  currentSpec?: ChartSpec,
): Promise<Result<ChartSpec>> {
  const result = await postJson<{ spec: ChartSpec }>("/api/chart-spec", {
    datasetId,
    instruction,
    ...(currentSpec ? { currentSpec } : {}),
  });
  return result.ok ? { ok: true, value: result.value.spec } : result;
}

export function renderChart(datasetId: string, spec: ChartSpec): Promise<Result<RenderedData>> {
  return postJson<RenderedData>("/api/backend/charts/render", { datasetId, spec });
}

export async function createShare(datasetId: string, spec: ChartSpec): Promise<Result<string>> {
  // The server renders its own snapshot; a client-supplied one is rejected.
  const result = await postJson<{ shareId: string }>("/api/backend/shares", { datasetId, spec });
  return result.ok ? { ok: true, value: result.value.shareId } : result;
}
