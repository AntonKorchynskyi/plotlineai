import { test as base, expect } from "@playwright/test";
import path from "node:path";

export const GALLERY_CSV = (slug: string) =>
  path.resolve(import.meta.dirname, "../../backend/src/main/resources/gallery", `${slug}.csv`);

/**
 * Every page in the suite fails its test on a CSP violation or an uncaught error. Console
 * errors for failed requests are not counted: several specs provoke a 4xx on purpose.
 */
export const test = base.extend<{ problems: string[] }>({
  problems: [
    async ({ page }, use) => {
      const problems: string[] = [];
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (e) => {
          console.error(`CSP violation: ${e.violatedDirective} blocked ${e.blockedURI}`);
        });
      });
      page.on("console", (message) => {
        if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) {
          problems.push(message.text());
        }
      });
      page.on("pageerror", (error) => problems.push(error.message));

      await use(problems);

      expect(problems, "console errors or CSP violations").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
