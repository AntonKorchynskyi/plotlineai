/**
 * Token-bucket rate limiting for the AI routes, in memory (one web instance).
 *
 * Two buckets guard every request. The per-client bucket keeps one visitor from using up
 * everyone's allowance. The global bucket caps all clients together, and is what actually
 * protects the provider bill: the client key comes from X-Forwarded-For, which Next fills
 * from the socket only when the request does not already carry one. With web exposed
 * directly, a client can send its own header and pose as many clients. Once a proxy that
 * overwrites the header sits in front (the phase 9 deployment), the per-client key becomes
 * trustworthy too.
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

/** The client address as Next records it; see the module comment for how far to trust it. */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const key = forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
  return key.slice(0, 64);
}

const positiveInt = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return raw && Number.isInteger(n) && n > 0 ? n : fallback;
};

export function limitsFromEnv(): { perClient: BucketLimits; global: BucketLimits } {
  return {
    perClient: {
      capacity: positiveInt(process.env.RATE_LIMIT_CLIENT_BURST, 10),
      refillMs: positiveInt(process.env.RATE_LIMIT_CLIENT_REFILL_MS, 6000),
    },
    global: {
      capacity: positiveInt(process.env.RATE_LIMIT_GLOBAL_BURST, 30),
      refillMs: positiveInt(process.env.RATE_LIMIT_GLOBAL_REFILL_MS, 2000),
    },
  };
}

/** The limiter both AI routes share. */
export const aiRateLimiter = createRateLimiter(limitsFromEnv());
