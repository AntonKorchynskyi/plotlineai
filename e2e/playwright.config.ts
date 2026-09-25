import { defineConfig, devices } from "@playwright/test";

/**
 * Runs against the compose stack with the AI stub:
 *   docker compose -f docker-compose.yml -f docker-compose.e2e.yml up -d --build --wait
 *
 * The rate-limit spec drains a bucket for the one client address the whole suite shares,
 * so it runs as its own project after everything else. That bucket refills within a
 * minute, after which the suite can run again on the same stack.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "flows",
      testIgnore: /rate-limit\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "rate-limits",
      testMatch: /rate-limit\.spec\.ts/,
      dependencies: ["flows"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
