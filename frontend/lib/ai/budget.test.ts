import { afterEach, describe, expect, it, vi } from "vitest";
import { createDailyBudget, dailyLimitFromEnv } from "@/lib/ai/budget";
import { AiUnavailableError } from "@/lib/ai/errors";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const clock = (iso: string) => {
  let now = new Date(iso);
  return { now: () => now, set: (next: string) => (now = new Date(next)) };
};

describe("createDailyBudget", () => {
  it("allows calls up to the limit, then refuses", () => {
    const budget = createDailyBudget({ limit: 2, now: clock("2026-09-18T10:00:00Z").now });
    budget.consume();
    budget.consume();
    expect(() => budget.consume()).toThrow(AiUnavailableError);
  });

  it("reports what is left", () => {
    const budget = createDailyBudget({ limit: 3, now: clock("2026-09-18T10:00:00Z").now });
    budget.consume();
    expect(budget.remaining()).toBe(2);
  });

  it("starts over at midnight UTC", () => {
    const c = clock("2026-09-18T23:59:59Z");
    const budget = createDailyBudget({ limit: 1, now: c.now });
    budget.consume();
    expect(() => budget.consume()).toThrow(AiUnavailableError);

    c.set("2026-09-19T00:00:00Z");
    expect(() => budget.consume()).not.toThrow();
  });

  it("logs once when the ceiling is reached, not on every refusal", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const budget = createDailyBudget({ limit: 1, now: clock("2026-09-18T10:00:00Z").now });
    budget.consume();
    for (let i = 0; i < 3; i++) expect(() => budget.consume()).toThrow();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(warn.mock.calls[0][0] as string)).toMatchObject({
      event: "ai_daily_limit_reached",
      limit: 1,
      day: "2026-09-18",
    });
  });
});

describe("dailyLimitFromEnv", () => {
  it("defaults to 500", () => {
    vi.stubEnv("AI_DAILY_CALL_LIMIT", "");
    expect(dailyLimitFromEnv()).toBe(500);
  });

  it("reads a positive integer", () => {
    vi.stubEnv("AI_DAILY_CALL_LIMIT", "40");
    expect(dailyLimitFromEnv()).toBe(40);
  });

  it("ignores nonsense rather than disabling the ceiling", () => {
    for (const bad of ["abc", "-5", "0", "1.5"]) {
      vi.stubEnv("AI_DAILY_CALL_LIMIT", bad);
      expect(dailyLimitFromEnv()).toBe(500);
    }
  });
});
