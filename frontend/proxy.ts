import { NextResponse, type NextRequest } from "next/server";
import { clientKey } from "@/lib/rate-limit";
import { backendLimiters } from "@/lib/security/backend-limits";
import { BACKEND_PREFIX, backendDecision } from "@/lib/security/backend-paths";
import { buildCsp, createNonce } from "@/lib/security/csp";
import { isCrossSite, isStateChanging } from "@/lib/security/origin";

/**
 * The gate in front of every request web serves:
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

function guardApi(request: NextRequest): NextResponse {
  const { method } = request;
  const { pathname } = request.nextUrl;

  if (isStateChanging(method) && isCrossSite(request)) {
    return failure(403, "FORBIDDEN", "Cross-site requests are not allowed.");
  }

  if (pathname === BACKEND_PREFIX || pathname.startsWith(`${BACKEND_PREFIX}/`)) {
    const decision = backendDecision(method, pathname);
    if (!decision.allowed) return failure(404, "NOT_FOUND", "Resource not found");

    if (decision.bucket) {
      const limit = backendLimiters[decision.bucket].check(clientKey(request));
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
  const csp = buildCsp(createNonce(), { dev: process.env.NODE_ENV === "development" });

  // Next reads the nonce back out of the request's CSP header while rendering.
  const headers = new Headers(request.headers);
  headers.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export function proxy(request: NextRequest) {
  return request.nextUrl.pathname.startsWith("/api/") ? guardApi(request) : withCsp(request);
}

export const config = {
  // Build output carries no user content and gets no nonce; everything else passes through.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
