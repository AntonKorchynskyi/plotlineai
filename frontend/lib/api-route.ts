import type { z } from "zod";
import { AiBadOutputError, AiBudgetRefusedError, AiUnavailableError } from "@/lib/ai/errors";
import { emptyCallRecord, type AiCallRecord, type AiDeps } from "@/lib/ai/structured-call";
import { BackendError, DatasetNotFoundError, fetchDataset, type DatasetDetail } from "@/lib/backend";
import { lambdaRequestId, publishEvent } from "@/lib/events";
import { aiRateLimiter, clientKey } from "@/lib/rate-limit";

/**
 * The pipeline both AI route handlers share: rate limit, bounded body, validation, dataset
 * lookup, then the AI call, with every failure mapped onto the api's { error, message }
 * envelope. Messages are generic and never echo the input or the underlying error.
 */

/** Far above any legitimate body (a UUID, 500 characters and one ChartSpec). */
const MAX_BODY_BYTES = 16 * 1024;

const error = (status: number, code: string, message: string, headers?: HeadersInit) =>
  Response.json({ error: code, message }, { status, headers });

/** Logs what failed without its message, which may carry provider or request details. */
function logFailure(route: string, failure: unknown) {
  const cause = failure instanceof Error ? failure.cause : undefined;
  console.error(
    JSON.stringify({
      event: "ai_route_failed",
      route,
      error: failure instanceof Error ? failure.name : typeof failure,
      cause: cause instanceof Error ? cause.name : undefined,
    }),
  );
}

type AiOutcome = "ok" | "bad_output" | "unavailable" | "budget_refused";

const outcomeOf = (failure: unknown): AiOutcome | null => {
  if (failure instanceof AiBadOutputError) return "bad_output";
  if (failure instanceof AiBudgetRefusedError) return "budget_refused";
  if (failure instanceof AiUnavailableError) return "unavailable";
  return null;
};

/** One `ai.called` per AI attempt, whatever its outcome (infra/events/schema.md). */
function reportCall(request: Request, route: string, record: AiCallRecord, ms: number, outcome: AiOutcome) {
  return publishEvent("ai.called", { route, ...record, ms, outcome }, { requestId: lambdaRequestId(request) });
}

async function readBody(request: Request): Promise<{ ok: true; json: unknown } | Response> {
  const declared = Number(request.headers.get("content-length"));
  if (declared > MAX_BODY_BYTES) {
    return error(413, "PAYLOAD_TOO_LARGE", "The request body is too large.");
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return error(413, "PAYLOAD_TOO_LARGE", "The request body is too large.");
  }
  try {
    return { ok: true, json: JSON.parse(text) };
  } catch {
    return error(400, "INVALID_REQUEST", "The request body is not valid JSON.");
  }
}

export async function handleAiRoute<B extends { datasetId: string }>(
  request: Request,
  route: string,
  schema: z.ZodType<B>,
  run: (body: B, dataset: DatasetDetail, deps: AiDeps) => Promise<unknown>,
): Promise<Response> {
  const limit = await aiRateLimiter.check(clientKey(request));
  if (!limit.ok) {
    return error(429, "RATE_LIMITED", "Too many requests. Try again shortly.", {
      "Retry-After": String(limit.retryAfterSeconds),
    });
  }

  const body = await readBody(request);
  if (body instanceof Response) return body;

  const parsed = schema.safeParse(body.json);
  if (!parsed.success) {
    return error(400, "INVALID_REQUEST", "The request is not valid.");
  }

  const record = emptyCallRecord();
  let start = 0;
  const elapsed = () => Math.round(performance.now() - start);
  try {
    const dataset = await fetchDataset(parsed.data.datasetId);
    start = performance.now();
    const result = await run(parsed.data, dataset, { record });
    await reportCall(request, route, record, elapsed(), "ok");
    return Response.json(result);
  } catch (failure) {
    // Only the AI call throws these, so the dataset lookup never counts as an attempt.
    const outcome = outcomeOf(failure);
    if (outcome) await reportCall(request, route, record, elapsed(), outcome);

    if (failure instanceof DatasetNotFoundError) {
      return error(404, "NOT_FOUND", "That dataset does not exist or has expired.");
    }
    logFailure(route, failure);
    if (failure instanceof BackendError) {
      return error(503, "BACKEND_UNAVAILABLE", "The data service is unavailable right now.");
    }
    if (failure instanceof AiUnavailableError) {
      return error(503, "AI_UNAVAILABLE", "Chart suggestions are unavailable right now.");
    }
    if (failure instanceof AiBadOutputError) {
      return error(502, "AI_BAD_OUTPUT", "The suggestion service returned an unusable chart.");
    }
    return error(500, "INTERNAL", "Something went wrong.");
  }
}
