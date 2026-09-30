/**
 * Refuses a state-changing request that a browser sent on behalf of another site. There are
 * no cookies to steal, but an attacker's page could still spend this app's upload, share
 * and AI budgets through a visitor's browser.
 *
 * Browsers mark every such request: Sec-Fetch-Site says "cross-site", and Origin names the
 * other site. A request with neither is not from a browser at all, and could forge them
 * anyway, so it is left to the rate limits.
 */
export function isCrossSite(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return true;

  const origin = request.headers.get("origin");
  if (!origin) return false;
  // "null" is what a sandboxed iframe or a file: page sends.
  if (origin === "null") return true;

  // The host the browser addressed. Proxies call web under another name and pass that one on:
  // CloudFront (a viewer-request function in infra/lib/app-stack.ts) and Caddy both set
  // X-Forwarded-Host. A browser cannot add it to a cross-site request without a CORS
  // preflight, which web never approves.
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const isStateChanging = (method: string) => !SAFE_METHODS.has(method.toUpperCase());
