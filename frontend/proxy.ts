import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { clientKey } from "@/lib/rate-limit";
import { backendLimiters } from "@/lib/security/backend-limits";
import { BACKEND_PREFIX, backendDecision } from "@/lib/security/backend-paths";
import { buildCsp, createNonce } from "@/lib/security/csp";
import { isCrossSite, isStateChanging } from "@/lib/security/origin";
import { originVerifySecret } from "@/lib/security/runtime-secrets";

/**
 * The gate in front of every request web serves:
 * - on AWS, only requests that came through CloudFront get in: CloudFront adds a secret
 *   X-Origin-Verify header, and anything without it reached the function URL directly;
 * - pages get a per-request CSP nonce;
 * - no other site can make a visitor's browser post to the api;
 * - the /api/backend rewrite reaches only the api paths the browser needs, each rate
 *   limited by what it costs.
 *
 * Errors use the api's { error, message } envelope, so the browser client reads them like
 * any other failure.
 */

const failure = (status: number, error: string, message: string, headers?: HeadersInit) =>
  NextResponse.json({ error, message }, { status, headers });

async function guardApi(request: NextRequest): Promise<NextResponse> {
  const { method } = request;
  const { pathname } = request.nextUrl;

  if (isStateChanging(method) && isCrossSite(request)) {
    return failure(403, "FORBIDDEN", "Cross-site requests are not allowed.");
  }

  if (pathname === BACKEND_PREFIX || pathname.startsWith(`${BACKEND_PREFIX}/`)) {
    const decision = backendDecision(method, pathname);
    if (!decision.allowed) return failure(404, "NOT_FOUND", "Resource not found");

    if (decision.bucket) {
      const limit = await backendLimiters[decision.bucket].check(clientKey(request));
      if (!limit.ok) {
        return failure(429, "RATE_LIMITED", "Too many requests. Try again shortly.", {
          "Retry-After": String(limit.retryAfterSeconds),
        });
      }
    }
  }

  return NextResponse.next();
}

function withCsp(request: NextRequest): NextResponse {
  const csp = buildCsp(createNonce(), {
    dev: process.env.NODE_ENV === "development",
    uploadOrigin: process.env.UPLOAD_ORIGIN,
  });

  // Next reads the nonce back out of the request's CSP header while rendering.
  const headers = new Headers(request.headers);
  headers.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("content-security-policy", csp);
  return response;
}

/** Compares in constant time, so the response time says nothing about how close a guess was. */
function sameSecret(sent: string | null, expected: string): boolean {
  const a = Buffer.from(sent ?? "");
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Build output carries no user content and gets no nonce. */
const isBuildOutput = (pathname: string) =>
  pathname.startsWith("/_next/static/") ||
  pathname.startsWith("/_next/image") ||
  pathname === "/favicon.ico";

export async function proxy(request: NextRequest): Promise<NextResponse> {
  let secret: string | undefined;
  try {
    secret = await originVerifySecret();
  } catch (error) {
    // Fails closed: without the secret there is no telling CloudFront from anyone else.
    const name = error instanceof Error ? error.name : typeof error;
    console.error(JSON.stringify({ event: "origin_secret_unavailable", error: name }));
    return failure(503, "UNAVAILABLE", "The service is unavailable right now.");
  }
  if (secret && !sameSecret(request.headers.get("x-origin-verify"), secret)) {
    return failure(403, "FORBIDDEN", "Forbidden");
  }

  const { pathname } = request.nextUrl;
  if (isBuildOutput(pathname)) return NextResponse.next();
  return pathname.startsWith("/api/") ? guardApi(request) : withCsp(request);
}

export const config = {
  // Every path, so the origin check covers build output too.
  matcher: ["/:path*"],
};
