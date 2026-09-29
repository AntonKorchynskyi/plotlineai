import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AI_LIMITS,
  clientKey,
  createRateLimiter,
  limitsFromEnv,
  trustedProxyHops,
} from "@/lib/rate-limit";
import { createMemoryStore, type CounterStore } from "@/lib/rate-limit-store";

// Starts 10 s into a 60 s window, so the window ends in 50 s.
const clock = () => {
  let t = 1_800_000_010_000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const limiter = (
  limits = { clientLimit: 2, globalLimit: 3, windowSeconds: 60 },
  store: CounterStore = createMemoryStore(),
) => {
  const c = clock();
  return { ...c, store, limiter: createRateLimiter({ bucket: "t", limits, store, now: c.now }) };
};

describe("createRateLimiter", () => {
  it("allows a client up to its limit, then refuses until the window ends", async () => {
    const { limiter: l } = limiter();
    expect(await l.check("a")).toEqual({ ok: true });
    expect(await l.check("a")).toEqual({ ok: true });
    expect(await l.check("a")).toEqual({ ok: false, retryAfterSeconds: 50 });
  });

  it("starts every client over in the next window", async () => {
    const { limiter: l, advance } = limiter();
    await l.check("a");
    await l.check("a");
    advance(50_000);
    expect(await l.check("a")).toEqual({ ok: true });
  });

  it("caps everyone together, so rotating client addresses does not help", async () => {
    const { limiter: l } = limiter();
    expect((await l.check("a")).ok).toBe(true);
    expect((await l.check("b")).ok).toBe(true);
    expect((await l.check("c")).ok).toBe(true);
    expect(await l.check("d")).toEqual({ ok: false, retryAfterSeconds: 50 });
  });

  it("does not spend the global allowance on a client that is already refused", async () => {
    const { limiter: l } = limiter({ clientLimit: 1, globalLimit: 2, windowSeconds: 60 });
    await l.check("a");
    await l.check("a");
    await l.check("a");
    expect((await l.check("b")).ok).toBe(true);
  });

  it("keys the counters by bucket, scope and window start", async () => {
    const increment = vi.fn(async () => true);
    const { limiter: l } = limiter(undefined, { increment });
    await l.check("203.0.113.9");
    expect(increment.mock.calls).toEqual([
      ["t#c:203.0.113.9#1800000000", 2, 1800000120],
      ["t#g#1800000000", 3, 1800000120],
    ]);
  });

  it("lets requests through and logs when the store fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { limiter: l } = limiter(undefined, {
      increment: async () => {
        throw new Error("ProvisionedThroughputExceeded");
      },
    });
    expect(await l.check("a")).toEqual({ ok: true });
    expect(error).toHaveBeenCalledWith(expect.stringContaining("rate_limit_store_failed"));
  });

  it("lets requests through when the store does not answer within 300 ms", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { limiter: l } = limiter(undefined, { increment: () => new Promise(() => {}) });
    const result = l.check("a");
    // One timeout for the client counter, then one for the global counter.
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(300);
    expect(await result).toEqual({ ok: true });
  });
});

describe("createMemoryStore", () => {
  it("counts up to the limit per key", async () => {
    const store = createMemoryStore(() => 0);
    expect(await store.increment("k", 1, 60)).toBe(true);
    expect(await store.increment("k", 1, 60)).toBe(false);
    expect(await store.increment("other", 1, 60)).toBe(true);
  });

  it("forgets expired keys", async () => {
    let now = 0;
    const store = createMemoryStore(() => now);
    await store.increment("k", 1, 60);
    now = 61_000;
    expect(await store.increment("k", 1, 120)).toBe(true);
  });
});

describe("clientKey", () => {
  const request = (headers: Record<string, string>) =>
    new Request("http://localhost/api/suggest", { method: "POST", headers });

  describe("behind Caddy (CLIENT_IP_SOURCE unset or xff)", () => {
    it("uses the address Next records from the socket", () => {
      expect(clientKey(request({ "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
    });

    it("takes the address the trusted proxy appended, not what the client sent", () => {
      expect(clientKey(request({ "x-forwarded-for": "203.0.113.66, 198.51.100.4" }))).toBe(
        "198.51.100.4",
      );
    });

    it("counts further from the right behind a second proxy", () => {
      const headers = { "x-forwarded-for": "203.0.113.66, 198.51.100.4, 35.191.0.1" };
      expect(clientKey(request(headers), 2)).toBe("198.51.100.4");
    });

    it("falls back when the chain is shorter than the trusted hops", () => {
      const headers = { "x-forwarded-for": "198.51.100.4", "x-real-ip": "192.0.2.9" };
      expect(clientKey(request(headers), 2)).toBe("192.0.2.9");
    });

    it("ignores blank entries and keeps IPv6 addresses whole", () => {
      expect(clientKey(request({ "x-forwarded-for": " , 2001:db8::1 ,, " }))).toBe("2001:db8::1");
      expect(clientKey(request({ "x-forwarded-for": "", "x-real-ip": "192.0.2.9" }))).toBe(
        "192.0.2.9",
      );
    });

    it("falls back to x-real-ip, then to a shared key", () => {
      expect(clientKey(request({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
      expect(clientKey(request({}))).toBe("unknown");
    });

    it("bounds what a hostile header can put into the key", () => {
      expect(
        clientKey(request({ "x-forwarded-for": "x".repeat(5000) })).length,
      ).toBeLessThanOrEqual(64);
    });
  });

  describe("behind CloudFront (CLIENT_IP_SOURCE=cloudfront)", () => {
    const cloudfront = (headers: Record<string, string>) => {
      vi.stubEnv("CLIENT_IP_SOURCE", "cloudfront");
      return clientKey(request(headers));
    };

    it("takes the viewer address CloudFront recorded, without its port", () => {
      expect(cloudfront({ "cloudfront-viewer-address": "203.0.113.9:4432" })).toBe("203.0.113.9");
      expect(cloudfront({ "cloudfront-viewer-address": "2001:db8::1:4432" })).toBe("2001:db8::1");
    });

    it("ignores X-Forwarded-For, which the client can write", () => {
      expect(
        cloudfront({
          "cloudfront-viewer-address": "203.0.113.9:4432",
          "x-forwarded-for": "198.51.100.77",
        }),
      ).toBe("203.0.113.9");
    });

    it("shares one key when the header is missing", () => {
      expect(cloudfront({ "x-forwarded-for": "198.51.100.77" })).toBe("unknown");
    });
  });
});

describe("trustedProxyHops", () => {
  it("defaults to one proxy", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "");
    expect(trustedProxyHops()).toBe(1);
  });

  it("reads a positive integer and ignores nonsense", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
    expect(trustedProxyHops()).toBe(2);
    for (const bad of ["abc", "0", "-1", "1.5"]) {
      vi.stubEnv("TRUSTED_PROXY_HOPS", bad);
      expect(trustedProxyHops()).toBe(1);
    }
  });
});

describe("limitsFromEnv", () => {
  it("has the AI defaults", () => {
    expect(limitsFromEnv("AI", AI_LIMITS)).toEqual({
      clientLimit: 10,
      globalLimit: 30,
      windowSeconds: 60,
    });
  });

  it("reads overrides for its own bucket and ignores nonsense", () => {
    vi.stubEnv("RATE_LIMIT_WRITE_CLIENT_LIMIT", "3");
    vi.stubEnv("RATE_LIMIT_WRITE_GLOBAL_LIMIT", "abc");
    vi.stubEnv("RATE_LIMIT_WRITE_WINDOW_SECONDS", "0");
    vi.stubEnv("RATE_LIMIT_AI_CLIENT_LIMIT", "99");
    expect(limitsFromEnv("WRITE", { clientLimit: 8, globalLimit: 60, windowSeconds: 60 })).toEqual({
      clientLimit: 3,
      globalLimit: 60,
      windowSeconds: 60,
    });
  });
});
