import { expect, test } from "./fixtures";

// Runs last (its own project): it drains the render bucket for the suite's one address.
// The e2e overlay sizes that bucket at 40, refilling one every 1.5s, so the bucket is full
// again a minute later and the suite can run again on the same stack.

test("hammering the render endpoint ends in 429, and a forged address does not help", async ({
  request,
  baseURL,
}) => {
  const render = (headers: Record<string, string> = {}) =>
    request.post("/api/backend/charts/render", {
      headers: { origin: baseURL!, ...headers },
      data: {},
    });

  let limited = null;
  for (let i = 0; i < 60 && !limited; i++) {
    const response = await render();
    if (response.status() === 429) limited = response;
  }

  expect(limited, "no 429 within 60 renders").not.toBeNull();
  expect(Number(limited!.headers()["retry-after"])).toBeGreaterThan(0);
  expect((await limited!.json()).error).toBe("RATE_LIMITED");

  // Straight away, before the bucket earns a token back: the proxy overwrites the header,
  // so this is the same client as before.
  expect((await render({ "x-forwarded-for": "198.51.100.77" })).status()).toBe(429);
});
