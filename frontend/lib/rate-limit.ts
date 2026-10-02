import { defaultStore, type CounterStore } from "@/lib/rate-limit-store";

/**
 * Fixed-window rate limiting with counters in a shared store (DynamoDB on AWS and under
 * compose), so every web instance agrees on the count.
 *
 * Two counters guard every request. The per-client one keeps one visitor from using up
 * everyone's allowance. The global one caps all clients together, and is what finally protects
 * the provider bill and the database. A fixed window can let up to twice the limit through
 * around a window boundary; that is the price of one atomic write per counter and no
 * read-modify-write race.
 *
 * Rate limiting fails open: if the store errors or is slow, the request goes ahead and the
 * failure is logged. The AI daily budget (lib/ai/budget.ts) fails closed, and that is the
 * actual cost ceiling.
 *
 * The client key depends on what sits in front of web (CLIENT_IP_SOURCE):
 * - `cloudfront` (AWS): CloudFront-Viewer-Address, which CloudFront sets from the TCP peer.
 *   web only accepts requests that came through CloudFront (proxy.ts, X-Origin-Verify), so a
 *   client cannot supply it, and X-Forwarded-For, which a client can write, is ignored.
 * - `xff` (default, compose): X-Forwarded-For read from the right. Caddy (deploy/Caddyfile)
 *   replaces the header with the peer address, so the trusted entry is the last one and
 *   everything to its left is the client's to forge. TRUSTED_PROXY_HOPS counts the proxies
 *   that append an entry, for when a second one sits in front.
 */

export type TakeResult = { ok: true } | { ok: false; retryAfterSeconds: number };

export type WindowLimits = { clientLimit: number; globalLimit: number; windowSeconds: number };

/** How long the store gets before a request goes ahead without it. */
const STORE_TIMEOUT_MS = 300;

export function createRateLimiter(options: {
  bucket: string;
  limits: WindowLimits;
  store?: CounterStore;
  now?: () => number;
  timeoutMs?: number;
}) {
  const { bucket, limits } = options;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? STORE_TIMEOUT_MS;
  const store = () => options.store ?? defaultStore();

  /** True when the counter had room, or when the store could not say. */
  const increment = async (key: string, limit: number, expiresAt: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    try {
      const answer = await Promise.race([store().increment(key, limit, expiresAt), timeout]);
      if (answer === "timeout") throw new Error("rate limit store timed out");
      return answer;
    } catch (failure) {
      console.error(
        JSON.stringify({
          event: "rate_limit_store_failed",
          bucket,
          error: failure instanceof Error ? failure.name : typeof failure,
        }),
      );
      return true;
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    async check(clientKey: string): Promise<TakeResult> {
      const at = now();
      const windowMs = limits.windowSeconds * 1000;
      const start = Math.floor(at / windowMs) * windowMs;
      const end = start + windowMs;
      const window = start / 1000;
      // Kept a minute past the window, so a slow clock elsewhere never sees it reset early.
      const expiresAt = end / 1000 + 60;
      const refused: TakeResult = {
        ok: false,
        retryAfterSeconds: Math.max(1, Math.ceil((end - at) / 1000)),
      };

      if (!(await increment(`${bucket}#c:${clientKey}#${window}`, limits.clientLimit, expiresAt))) {
        return refused;
      }
      if (!(await increment(`${bucket}#g#${window}`, limits.globalLimit, expiresAt))) {
        return refused;
      }
      return { ok: true };
    },
  };
}

const positiveInt = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return raw && Number.isInteger(n) && n > 0 ? n : fallback;
};

/** How many proxies in front of web append to X-Forwarded-For; see the module comment. */
export const trustedProxyHops = () => positiveInt(process.env.TRUSTED_PROXY_HOPS, 1);

/** The client address the trusted front recorded; see the module comment. */
export function clientKey(request: Request, hops = trustedProxyHops()): string {
  let key: string | undefined;
  if (process.env.CLIENT_IP_SOURCE === "cloudfront") {
    // "203.0.113.9:4432", or for IPv6 "2001:db8::1:4432": the port follows the last colon.
    const viewer = request.headers.get("cloudfront-viewer-address")?.trim() ?? "";
    const portAt = viewer.lastIndexOf(":");
    key = portAt > 0 ? viewer.slice(0, portAt) : viewer;
  } else {
    const chain = (request.headers.get("x-forwarded-for") ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const forwarded = chain.length >= hops ? chain[chain.length - hops] : "";
    key = forwarded || request.headers.get("x-real-ip")?.trim();
  }
  return (key || "unknown").slice(0, 64);
}

/** The AI routes' limits, per 60 s window. */
export const AI_LIMITS: WindowLimits = { clientLimit: 10, globalLimit: 30, windowSeconds: 60 };

/**
 * Limits from `RATE_LIMIT_<bucket>_CLIENT_LIMIT`, `..._GLOBAL_LIMIT` and `..._WINDOW_SECONDS`,
 * each falling back to `defaults`.
 */
export function limitsFromEnv(bucket: "AI" | "WRITE" | "RENDER", defaults: WindowLimits): WindowLimits {
  const env = (name: string) => process.env[`RATE_LIMIT_${bucket}_${name}`];
  return {
    clientLimit: positiveInt(env("CLIENT_LIMIT"), defaults.clientLimit),
    globalLimit: positiveInt(env("GLOBAL_LIMIT"), defaults.globalLimit),
    windowSeconds: positiveInt(env("WINDOW_SECONDS"), defaults.windowSeconds),
  };
}

/** The limiter both AI routes share. */
export const aiRateLimiter = createRateLimiter({ bucket: "ai", limits: limitsFromEnv("AI", AI_LIMITS) });
