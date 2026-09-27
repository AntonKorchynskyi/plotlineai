/**
 * Token-bucket rate limiting, in memory (one web instance).
 *
 * Two buckets guard every request. The per-client bucket keeps one visitor from using up
 * everyone's allowance. The global bucket caps all clients together, and is what finally
 * protects the provider bill and the database.
 *
 * The client key comes from X-Forwarded-For, read from the right. web is never reached
 * directly: a trusted proxy in front of it records the real peer address. Caddy
 * (deploy/Caddyfile) replaces the header with that address; Google's front end on Cloud Run
 * appends it to whatever the client sent. Either way the trusted entry is the last one, and
 * everything to its left is the client's to forge. TRUSTED_PROXY_HOPS counts the proxies
 * that append an entry, for when a second one (a load balancer) sits in front.
 *
 * In-memory buckets are only correct while web runs as a single instance, which is why the
 * Cloud Run service caps itself at one (deploy/cloudrun/service.yaml).
 */

export type TakeResult = { ok: true } | { ok: false; retryAfterSeconds: number };

type Bucket = { tokens: number; updatedAt: number };

export type BucketLimits = { capacity: number; refillMs: number };

export function createTokenBucket(
  options: BucketLimits & { maxKeys?: number; now?: () => number },
) {
  const { capacity, refillMs } = options;
  const maxKeys = options.maxKeys ?? 10_000;
  const now = options.now ?? Date.now;
  const buckets = new Map<string, Bucket>();

  /** Tops a bucket up for the time elapsed, keeping partial progress towards the next token. */
  const refill = (bucket: Bucket, at: number) => {
    const earned = Math.floor((at - bucket.updatedAt) / refillMs);
    if (earned <= 0) return;
    bucket.tokens = Math.min(capacity, bucket.tokens + earned);
    bucket.updatedAt = bucket.tokens === capacity ? at : bucket.updatedAt + earned * refillMs;
  };

  /**
   * A full bucket holds no information: a new one would behave identically. Drop those, and
   * if that is not enough (a flood of distinct keys), start over rather than grow without
   * bound. The global bucket still holds the line while the per-client state is rebuilt.
   */
  const sweep = (at: number) => {
    for (const [key, bucket] of buckets) {
      refill(bucket, at);
      if (bucket.tokens >= capacity) buckets.delete(key);
    }
    if (buckets.size > maxKeys) buckets.clear();
  };

  return {
    take(key: string): TakeResult {
      const at = now();
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { tokens: capacity, updatedAt: at };
        buckets.set(key, bucket);
      }
      refill(bucket, at);

      let result: TakeResult;
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        result = { ok: true };
      } else {
        const waitMs = refillMs - (at - bucket.updatedAt);
        result = { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
      }

      if (buckets.size > maxKeys) sweep(at);
      return result;
    },
    size: () => buckets.size,
  };
}

export function createRateLimiter(options: {
  perClient: BucketLimits;
  global: BucketLimits;
  now?: () => number;
}) {
  const perClient = createTokenBucket({ ...options.perClient, now: options.now });
  const global = createTokenBucket({ ...options.global, now: options.now });
  return {
    check(clientKey: string): TakeResult {
      const own = perClient.take(clientKey);
      return own.ok ? global.take("*") : own;
    },
  };
}

const positiveInt = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return raw && Number.isInteger(n) && n > 0 ? n : fallback;
};

/** How many proxies in front of web append to X-Forwarded-For; see the module comment. */
export const trustedProxyHops = () => positiveInt(process.env.TRUSTED_PROXY_HOPS, 1);

/** The client address the nearest trusted proxy recorded; see the module comment. */
export function clientKey(request: Request, hops = trustedProxyHops()): string {
  const chain = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const forwarded = chain.length >= hops ? chain[chain.length - hops] : "";
  const key = forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
  return key.slice(0, 64);
}

export type Limits = { perClient: BucketLimits; global: BucketLimits };

/** The AI routes' limits: per client a burst of 10, one more every 6s; 30 / 2s globally. */
export const AI_LIMITS: Limits = {
  perClient: { capacity: 10, refillMs: 6000 },
  global: { capacity: 30, refillMs: 2000 },
};

/**
 * Limits from `${prefix}_CLIENT_BURST`, `${prefix}_CLIENT_REFILL_MS`, `${prefix}_GLOBAL_BURST`
 * and `${prefix}_GLOBAL_REFILL_MS`, each falling back to `defaults`.
 */
export function limitsFromEnv(prefix = "RATE_LIMIT", defaults: Limits = AI_LIMITS): Limits {
  const env = (name: string) => process.env[`${prefix}_${name}`];
  return {
    perClient: {
      capacity: positiveInt(env("CLIENT_BURST"), defaults.perClient.capacity),
      refillMs: positiveInt(env("CLIENT_REFILL_MS"), defaults.perClient.refillMs),
    },
    global: {
      capacity: positiveInt(env("GLOBAL_BURST"), defaults.global.capacity),
      refillMs: positiveInt(env("GLOBAL_REFILL_MS"), defaults.global.refillMs),
    },
  };
}

/** The limiter both AI routes share. */
export const aiRateLimiter = createRateLimiter(limitsFromEnv());
