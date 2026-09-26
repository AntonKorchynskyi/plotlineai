import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clientKey,
  createRateLimiter,
  createTokenBucket,
  limitsFromEnv,
  trustedProxyHops,
} from "@/lib/rate-limit";

const clock = () => {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};

afterEach(() => vi.unstubAllEnvs());

describe("createTokenBucket", () => {
  it("allows a burst up to capacity, then refuses", () => {
    const c = clock();
    const bucket = createTokenBucket({ capacity: 3, refillMs: 1000, now: c.now });
    expect([bucket.take("a"), bucket.take("a"), bucket.take("a")].every((r) => r.ok)).toBe(true);
    expect(bucket.take("a").ok).toBe(false);
  });

  it("refills one token per interval", () => {
    const c = clock();
    const bucket = createTokenBucket({ capacity: 1, refillMs: 1000, now: c.now });
    bucket.take("a");
    expect(bucket.take("a").ok).toBe(false);

    c.advance(999);
    expect(bucket.take("a").ok).toBe(false);
    c.advance(1);
    expect(bucket.take("a").ok).toBe(true);
  });

  it("never refills past capacity", () => {
    const c = clock();
    const bucket = createTokenBucket({ capacity: 2, refillMs: 1000, now: c.now });
    bucket.take("a");
    c.advance(60_000);
    expect([bucket.take("a"), bucket.take("a")].every((r) => r.ok)).toBe(true);
    expect(bucket.take("a").ok).toBe(false);
  });

  it("says how long until the next token", () => {
    const c = clock();
    const bucket = createTokenBucket({ capacity: 1, refillMs: 6000, now: c.now });
    bucket.take("a");
    c.advance(1500);
    const refused = bucket.take("a");
    expect(refused).toEqual({ ok: false, retryAfterSeconds: 5 });
  });

  it("keeps each key's allowance separate", () => {
    const c = clock();
    const bucket = createTokenBucket({ capacity: 1, refillMs: 1000, now: c.now });
    expect(bucket.take("a").ok).toBe(true);
    expect(bucket.take("a").ok).toBe(false);
    expect(bucket.take("b").ok).toBe(true);
  });

  it("forgets keys that have refilled, so memory tracks only recent clients", () => {
    const c = clock();
    const bucket = createTokenBucket({ capacity: 1, refillMs: 1000, maxKeys: 3, now: c.now });
    for (const key of ["a", "b", "c"]) bucket.take(key);
    c.advance(1000);
    bucket.take("d");
    expect(bucket.size()).toBeLessThanOrEqual(3);
  });

  it("stays bounded under a flood of distinct keys", () => {
    const c = clock();
    const bucket = createTokenBucket({ capacity: 5, refillMs: 60_000, maxKeys: 100, now: c.now });
    for (let i = 0; i < 10_000; i++) bucket.take(`spoofed-${i}`);
    expect(bucket.size()).toBeLessThanOrEqual(100);
  });
});

describe("createRateLimiter", () => {
  const limits = {
    perClient: { capacity: 2, refillMs: 1000 },
    global: { capacity: 3, refillMs: 1000 },
  };

  it("limits one client on its own", () => {
    const c = clock();
    const limiter = createRateLimiter({ ...limits, now: c.now });
    expect(limiter.check("1.1.1.1").ok).toBe(true);
    expect(limiter.check("1.1.1.1").ok).toBe(true);
    expect(limiter.check("1.1.1.1").ok).toBe(false);
  });

  it("caps everyone together, so rotating client addresses does not help", () => {
    const c = clock();
    const limiter = createRateLimiter({ ...limits, now: c.now });
    const results = ["a", "b", "c", "d", "e"].map((ip) => limiter.check(ip).ok);
    expect(results).toEqual([true, true, true, false, false]);
  });
});

describe("clientKey", () => {
  const request = (headers: Record<string, string>) =>
    new Request("http://localhost/api/suggest", { method: "POST", headers });

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
    expect(clientKey(request({ "x-forwarded-for": "x".repeat(5000) })).length).toBeLessThanOrEqual(
      64,
    );
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
  it("has defaults", () => {
    const limits = limitsFromEnv();
    expect(limits.perClient).toEqual({ capacity: 10, refillMs: 6000 });
    expect(limits.global).toEqual({ capacity: 30, refillMs: 2000 });
  });

  it("reads overrides and ignores nonsense", () => {
    vi.stubEnv("RATE_LIMIT_CLIENT_BURST", "4");
    vi.stubEnv("RATE_LIMIT_CLIENT_REFILL_MS", "abc");
    vi.stubEnv("RATE_LIMIT_GLOBAL_BURST", "0");
    vi.stubEnv("RATE_LIMIT_GLOBAL_REFILL_MS", "500");
    const limits = limitsFromEnv();
    expect(limits.perClient).toEqual({ capacity: 4, refillMs: 6000 });
    expect(limits.global).toEqual({ capacity: 30, refillMs: 500 });
  });

  it("reads another family of variables under its own prefix and defaults", () => {
    vi.stubEnv("RATE_LIMIT_WRITE_CLIENT_BURST", "3");
    vi.stubEnv("RATE_LIMIT_CLIENT_BURST", "99");
    const limits = limitsFromEnv("RATE_LIMIT_WRITE", {
      perClient: { capacity: 8, refillMs: 20_000 },
      global: { capacity: 60, refillMs: 1000 },
    });
    expect(limits.perClient).toEqual({ capacity: 3, refillMs: 20_000 });
    expect(limits.global).toEqual({ capacity: 60, refillMs: 1000 });
  });
});
