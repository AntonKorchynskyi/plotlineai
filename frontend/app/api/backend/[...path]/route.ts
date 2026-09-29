import type { NextRequest } from "next/server";
import { backendFetch } from "@/lib/backend";
import { BACKEND_PREFIX } from "@/lib/security/backend-paths";

/**
 * The browser's way to the api. proxy.ts runs first and has already applied the path
 * allowlist and the rate limits, so this only forwards: it replaced a next.config rewrite,
 * which could not sign requests for the api's IAM-protected function URL.
 *
 * The path is taken raw from the URL, the same string the allowlist decided on, never from
 * the decoded route params.
 */

/** Far above any legitimate body: a render or share request is a UUID and one ChartSpec. */
const MAX_BODY_BYTES = 64 * 1024;

/** Response headers the browser needs; everything else the api sends stays behind. */
const PASSED_BACK = ["content-type", "content-disposition", "retry-after"];

const failure = (status: number, error: string, message: string) =>
  Response.json({ error, message }, { status });

async function forward(request: NextRequest): Promise<Response> {
  const path = request.nextUrl.pathname.slice(BACKEND_PREFIX.length) + request.nextUrl.search;

  let body: string | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) {
      return failure(413, "PAYLOAD_TOO_LARGE", "The request body is too large.");
    }
    body = await request.text();
    if (body.length > MAX_BODY_BYTES) {
      return failure(413, "PAYLOAD_TOO_LARGE", "The request body is too large.");
    }
  }

  const headers: Record<string, string> = {};
  const contentType = request.headers.get("content-type");
  if (contentType) headers["content-type"] = contentType;

  let upstream: Response;
  try {
    upstream = await backendFetch(path, { method: request.method, headers, body });
  } catch {
    return failure(503, "BACKEND_UNAVAILABLE", "The data service is unavailable right now.");
  }

  const passed = new Headers();
  for (const name of PASSED_BACK) {
    const value = upstream.headers.get(name);
    if (value) passed.set(name, value);
  }
  return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers: passed });
}

export const GET = forward;
export const POST = forward;
