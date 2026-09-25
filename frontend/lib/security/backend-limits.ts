import type { BackendBucket } from "@/lib/security/backend-paths";
import { createRateLimiter, limitsFromEnv } from "@/lib/rate-limit";

/**
 * The limiters for api calls made through the /api/backend rewrite; see backend-paths.ts
 * for which call spends from which.
 *
 * write (RATE_LIMIT_WRITE_*): uploads and shares. A session uploads once and shares a few
 *   times, so per client: a burst of 8, one more every 20s; globally 60, one more a second.
 * render (RATE_LIMIT_RENDER_*): every chart drawn, three per upload for the thumbnails and
 *   one per refine. Per client: a burst of 30, one more every 2s; globally 200, 20 a second.
 */
export const backendLimiters: Record<BackendBucket, ReturnType<typeof createRateLimiter>> = {
  write: createRateLimiter(
    limitsFromEnv("RATE_LIMIT_WRITE", {
      perClient: { capacity: 8, refillMs: 20_000 },
      global: { capacity: 60, refillMs: 1000 },
    }),
  ),
  render: createRateLimiter(
    limitsFromEnv("RATE_LIMIT_RENDER", {
      perClient: { capacity: 30, refillMs: 2000 },
      global: { capacity: 200, refillMs: 50 },
    }),
  ),
};
