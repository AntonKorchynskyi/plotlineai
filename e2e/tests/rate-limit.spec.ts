import { expect, test } from "./fixtures";

// Runs last (its own project): it drains the render bucket for the suite's one address.
// The e2e overlay sizes that bucket at 40 with no refill during a run.

test("hammering the render endpoint ends in 429 with Retry-After", async ({
  request,
  baseURL,
}) => {
  const statuses: number[] = [];
  let retryAfter: string | undefined;

  for (let i = 0; i < 60; i++) {
    const response = await request.post("/api/backend/charts/render", {
      headers: { origin: baseURL! },
      data: {},
    });
    statuses.push(response.status());
    if (response.status() === 429) {
      retryAfter = response.headers()["retry-after"];
      expect((await response.json()).error).toBe("RATE_LIMITED");
      break;
    }
  }

  expect(statuses.at(-1)).toBe(429);
  expect(Number(retryAfter)).toBeGreaterThan(0);
});

test("a forged X-Forwarded-For does not buy a fresh bucket", async ({ request, baseURL }) => {
  const response = await request.post("/api/backend/charts/render", {
    headers: { origin: baseURL!, "x-forwarded-for": "198.51.100.77" },
    data: {},
  });
  expect(response.status()).toBe(429);
});
