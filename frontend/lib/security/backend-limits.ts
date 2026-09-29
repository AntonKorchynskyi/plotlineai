import type { BackendBucket } from "@/lib/security/backend-paths";
import { createRateLimiter, limitsFromEnv } from "@/lib/rate-limit";

/**
 * The limiters for api calls made through /api/backend; see backend-paths.ts for which call
 * spends from which. Limits are per 60 s window.
 *
 * write (RATE_LIMIT_WRITE_*): upload presigns, upload finalizes and shares. A session uploads
 *   once and shares a few times, so 8 per client and 60 across everyone.
 * render (RATE_LIMIT_RENDER_*): every chart drawn, three per upload for the thumbnails and one
 *   per refine: 30 per client and 1200 across everyone.
 */
export const backendLimiters: Record<BackendBucket, ReturnType<typeof createRateLimiter>> = {
  write: createRateLimiter({
    bucket: "write",
    limits: limitsFromEnv("WRITE", { clientLimit: 8, globalLimit: 60, windowSeconds: 60 }),
  }),
  render: createRateLimiter({
    bucket: "render",
    limits: limitsFromEnv("RENDER", { clientLimit: 30, globalLimit: 1200, windowSeconds: 60 }),
  }),
};
