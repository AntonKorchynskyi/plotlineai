import { expect, test } from "./fixtures";

test("pages carry the security headers and a nonce'd CSP", async ({ request }) => {
  for (const path of ["/", "/analyze"]) {
    const headers = (await request.get(path)).headers();

    expect(headers["content-security-policy"]).toMatch(
      /script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/,
    );
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("camera=()");
    expect(headers["x-powered-by"]).toBeUndefined();
    expect(headers["server"]).toBeUndefined();
  }
});

test("each page load gets its own nonce", async ({ request }) => {
  const nonce = async () =>
    /'nonce-([^']+)'/.exec((await request.get("/")).headers()["content-security-policy"])?.[1];
  expect(await nonce()).not.toBe(await nonce());
});

test("actuator and unlisted api paths are unreachable from outside", async ({ request }) => {
  for (const path of [
    "/api/backend/actuator/health",
    "/api/backend/actuator/env",
    "/api/backend/datasets",
    "/api/backend/gallery/..%2Factuator%2Fhealth/csv",
  ]) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
});

test("another site cannot post through a visitor's browser", async ({ request }) => {
  for (const path of ["/api/backend/shares", "/api/suggest", "/api/backend/datasets"]) {
    const response = await request.post(path, {
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      data: {},
    });
    expect(response.status(), path).toBe(403);
    expect((await response.json()).error).toBe("FORBIDDEN");
  }
});

test("an unknown share is a 404 page", async ({ page }) => {
  const response = await page.goto("/s/00000000-0000-4000-8000-000000000000");
  expect(response?.status()).toBe(404);
});
