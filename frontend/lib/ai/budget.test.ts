import { describe, expect, it, vi } from "vitest";
import { createApiBudget } from "@/lib/ai/budget";
import { AiUnavailableError } from "@/lib/ai/errors";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const budgetAnswering = (answer: () => Promise<Response>) => {
  const fetch = vi.fn<typeof globalThis.fetch>(answer);
  const budget = createApiBudget({ send: fetch });
  return { fetch, budget };
};

describe("createApiBudget", () => {
  it("asks the api to spend one call, and goes ahead when it is allowed", async () => {
    const { fetch, budget } = budgetAnswering(async () => json({ allowed: true }));

    await expect(budget.consume()).resolves.toBeUndefined();

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("/internal/ai-budget/consume");
    expect(init).toMatchObject({ method: "POST", cache: "no-store" });
  });

  it("refuses once the day's allowance is spent", async () => {
    const { budget } = budgetAnswering(async () => json({ allowed: false }));
    await expect(budget.consume()).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it("fails closed when the api cannot be reached", async () => {
    const down = new TypeError("fetch failed");
    const { budget } = budgetAnswering(async () => {
      throw down;
    });

    const error = await budget.consume().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiUnavailableError);
    expect((error as Error).cause).toBe(down);
  });

  it("fails closed when the api answers with an error", async () => {
    const { budget } = budgetAnswering(async () => json({ error: "INTERNAL" }, 500));
    await expect(budget.consume()).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it.each([
    ["an empty object", () => json({})],
    ["a string flag", () => json({ allowed: "true" })],
    ["not JSON", () => new Response("<html>", { status: 200 })],
  ])("fails closed on %s", async (_, answer) => {
    const { budget } = budgetAnswering(async () => answer());
    await expect(budget.consume()).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it("fails closed when the api is too slow to answer", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      (_, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const budget = createApiBudget({ send: fetch, timeoutMs: 20 });

    await expect(budget.consume()).rejects.toBeInstanceOf(AiUnavailableError);
  });
});
