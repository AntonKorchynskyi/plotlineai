/**
 * Which api paths the browser may reach through /api/backend. The route handler behind it
 * (app/api/backend/[...path]) forwards anything, so without this the whole api surface,
 * /internal included, would be public. Server-side code calls the api directly and is not
 * affected.
 *
 * Each entry also says which rate-limit bucket the call spends from, if any.
 */

export type BackendBucket = "write" | "render";

type Route = { method: string; pattern: RegExp; bucket: BackendBucket | null };

const SEGMENT = "[A-Za-z0-9-]{1,100}";

const ROUTES: Route[] = [
  { method: "GET", pattern: /^\/gallery$/, bucket: null },
  { method: "GET", pattern: new RegExp(`^/gallery/${SEGMENT}/csv$`), bucket: null },
  // A dataset is up to 5 MB stored for up to a week, and a share is a permanent row: the tight bucket.
  { method: "POST", pattern: /^\/datasets$/, bucket: "write" },
  { method: "POST", pattern: /^\/shares$/, bucket: "write" },
  // An aggregation over up to 100k rows: cheaper, but still work worth bounding.
  { method: "POST", pattern: /^\/charts\/render$/, bucket: "render" },
];

export const BACKEND_PREFIX = "/api/backend";

export type BackendDecision = { allowed: false } | { allowed: true; bucket: BackendBucket | null };

/**
 * Decides on the raw request path. Anything encoded, doubled or dotted fails the patterns,
 * so no spelling of a path can reach a route the list does not name.
 */
export function backendDecision(method: string, pathname: string): BackendDecision {
  if (!pathname.startsWith(`${BACKEND_PREFIX}/`)) return { allowed: false };
  const rest = pathname.slice(BACKEND_PREFIX.length);
  const verb = method.toUpperCase() === "HEAD" ? "GET" : method.toUpperCase();
  const route = ROUTES.find((r) => r.method === verb && r.pattern.test(rest));
  return route ? { allowed: true, bucket: route.bucket } : { allowed: false };
}
