import { describe, expect, it } from "vitest";
import { backendDecision } from "@/lib/security/backend-paths";

describe("backendDecision", () => {
  it.each([
    ["GET", "/api/backend/gallery", null],
    ["HEAD", "/api/backend/gallery", null],
    ["GET", "/api/backend/gallery/monthly-signups/csv", null],
    ["POST", "/api/backend/datasets/uploads", "write"],
    ["POST", "/api/backend/datasets", "write"],
    ["POST", "/api/backend/shares", "write"],
    ["POST", "/api/backend/charts/render", "render"],
  ])("lets %s %s through, spending from %s", (method, path, bucket) => {
    expect(backendDecision(method, path)).toEqual({ allowed: true, bucket });
  });

  it.each([
    ["GET", "/api/backend/actuator/health"],
    ["GET", "/api/backend/actuator/env"],
    // The AI budget is spent by web itself; a browser must not be able to drain it.
    ["POST", "/api/backend/internal/ai-budget/consume"],
    ["GET", "/api/backend/internal/ai-budget/consume"],
    // Datasets and shares are read server-side only; the browser never needs them.
    ["GET", "/api/backend/datasets/0b0c6f7e-3f1e-4d2b-9c1a-111111111111"],
    ["GET", "/api/backend/shares/0b0c6f7e-3f1e-4d2b-9c1a-111111111111"],
    ["DELETE", "/api/backend/datasets"],
    ["GET", "/api/backend/datasets"],
    ["POST", "/api/backend/gallery"],
    ["GET", "/api/backend"],
    ["GET", "/api/backend/"],
    ["POST", "/api/backend/datasets/"],
    ["POST", "/api/backend/charts/render/extra"],
    ["GET", "/api/backend/gallery/../actuator/health"],
    ["GET", "/api/backend/gallery/%2e%2e/csv"],
    ["GET", "/api/backend/gallery/a%2Fb/csv"],
    ["GET", "/api/backend//gallery"],
    ["GET", `/api/backend/gallery/${"a".repeat(101)}/csv`],
    ["GET", "/api/other/gallery"],
  ])("refuses %s %s", (method, path) => {
    expect(backendDecision(method, path)).toEqual({ allowed: false });
  });
});
