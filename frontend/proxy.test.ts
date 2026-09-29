// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A small write allowance in a long window, so a test can drain it. Set before the limiters
// are built; with no RATE_LIMIT_TABLE the counters live in memory.
vi.stubEnv("RATE_LIMIT_WRITE_CLIENT_LIMIT", "2");
vi.stubEnv("RATE_LIMIT_WRITE_WINDOW_SECONDS", "3600");

const { proxy } = await import("@/proxy");

let client = 0;
beforeEach(() => {
  client += 1;
});

const send = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  proxy(
    new NextRequest(`http://localhost:3000${path}`, {
      method: init.method ?? "GET",
      headers: {
        host: "localhost:3000",
        "x-forwarded-for": `203.0.113.${client}`,
        ...init.headers,
      },
    }),
  );

const sameSitePost = (path: string) =>
  send(path, { method: "POST", headers: { origin: "http://localhost:3000" } });

describe("proxy", () => {
  it("gives every page a fresh nonce'd CSP, and hands the same policy to the renderer", async () => {
    const first = await send("/analyze");
    const second = await send("/analyze");

    const csp = first.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(second.headers.get("content-security-policy")).not.toBe(csp);
    // NextResponse.next({ request: { headers } }) forwards overridden request headers this way.
    expect(first.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
  });

  it("puts no CSP on api responses", async () => {
    expect((await send("/api/backend/gallery")).headers.get("content-security-policy")).toBeNull();
  });

  it("refuses a cross-site post before anything else", async () => {
    const response = await send("/api/suggest", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "FORBIDDEN",
      message: "Cross-site requests are not allowed.",
    });
  });

  it("lets a same-origin post through to the route", async () => {
    expect((await sameSitePost("/api/suggest")).headers.get("x-middleware-next")).toBe("1");
  });

  it("answers 404 for any api path the browser has no business reaching", async () => {
    const response = await send("/api/backend/actuator/health");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "NOT_FOUND", message: "Resource not found" });
  });

  it("rate limits uploads per client, with Retry-After", async () => {
    expect((await sameSitePost("/api/backend/datasets")).status).toBe(200);
    expect((await sameSitePost("/api/backend/shares")).status).toBe(200);

    const limited = await sameSitePost("/api/backend/datasets");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await limited.json()).error).toBe("RATE_LIMITED");
  });

  it("keeps each client's write bucket its own", async () => {
    await sameSitePost("/api/backend/datasets");
    await sameSitePost("/api/backend/datasets");
    expect((await sameSitePost("/api/backend/datasets")).status).toBe(429);

    client += 1;
    expect((await sameSitePost("/api/backend/datasets")).status).toBe(200);
  });

  it("does not spend the write bucket on renders or gallery reads", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await sameSitePost("/api/backend/charts/render")).status).toBe(200);
      expect((await send("/api/backend/gallery")).status).toBe(200);
    }
    expect((await sameSitePost("/api/backend/datasets")).status).toBe(200);
  });
});
