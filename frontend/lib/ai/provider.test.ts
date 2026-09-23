import { afterEach, describe, expect, it, vi } from "vitest";
import { AiUnavailableError } from "@/lib/ai/errors";
import { callSettings } from "@/lib/ai/provider";

afterEach(() => vi.unstubAllEnvs());

describe("callSettings", () => {
  it("refuses to build a model without a key", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(() => callSettings()).toThrow(AiUnavailableError);
  });

  it("defaults to gpt-5-nano", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("AI_MODEL", "");
    const { model } = callSettings();
    expect(typeof model === "object" && model.modelId).toBe("gpt-5-nano");
  });

  it("honours AI_MODEL", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("AI_MODEL", "gpt-5-mini");
    const { model } = callSettings();
    expect(typeof model === "object" && model.modelId).toBe("gpt-5-mini");
  });

  it("bounds the output and keeps reasoning effort low", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const settings = callSettings();
    expect(settings.maxOutputTokens).toBeGreaterThan(0);
    expect(settings.maxOutputTokens).toBeLessThanOrEqual(8000);
    expect(settings.reasoning).toBe("low");
  });

  it("gives up rather than hanging on a slow provider", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    expect(callSettings().timeout).toBeGreaterThan(0);
    expect(callSettings().timeout).toBeLessThanOrEqual(30_000);
  });

  it("retries at most once, since every attempt costs money", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    expect(callSettings().maxRetries).toBeLessThanOrEqual(1);
  });
});
