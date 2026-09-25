import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { GALLERY_CSV, expect, test } from "./fixtures";

const specPanel = (page: Page) => page.locator("pre");

async function uploadRevenue(page: Page) {
  await page.goto("/analyze");
  await page.getByLabel("CSV file").setInputFiles(GALLERY_CSV("revenue-by-region"));
  await expect(page.getByRole("heading", { name: "Three charts worth a look" })).toBeVisible();
}

test("upload, pick a suggestion, refine, export and share", async ({ page, browser }) => {
  await uploadRevenue(page);

  await expect(page.getByText("revenue-by-region.csv", { exact: true })).toBeVisible();
  await expect(page.getByText("12 rows", { exact: true })).toBeVisible();
  const cards = page.getByRole("button").filter({ hasText: /^Suggestion \d/ });
  await expect(cards).toHaveCount(3);
  for (const card of await cards.all()) await expect(card.locator("canvas")).toBeVisible();

  // Pick the first suggestion: the full chart, with what went into it.
  await cards.filter({ hasText: "Total revenue by region" }).click();
  await expect(
    page.getByRole("heading", { level: 2, name: "Total revenue by region" }),
  ).toBeVisible();
  await expect(page.getByText("revenue-by-region.csv · 12 rows aggregated")).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible();
  await expect(specPanel(page)).toContainText('"chartType": "bar"');

  // Refine from the box, then from a chip. Each keeps the chart and changes its type.
  await page.getByLabel("make it a doughnut, top five only…").fill("show it as a line");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(specPanel(page)).toContainText('"chartType": "line"');
  await page.getByRole("button", { name: "Make it a doughnut" }).click();
  await expect(specPanel(page)).toContainText('"chartType": "doughnut"');
  const title = (await page.getByRole("heading", { level: 2 }).textContent())!;

  // PNG export: a real PNG, named after the chart.
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: /download png/i }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^total-revenue-by-region.*\.png$/);
  const png = await readFile((await download.path())!);
  expect(png.subarray(1, 4).toString()).toBe("PNG");

  // Share, then open the link as a stranger: same chart, read only.
  await page.getByRole("button", { name: /^share$/i }).click();
  const link = page.getByRole("link", { name: /\/s\/[0-9a-f-]{36}$/ });
  await expect(link).toBeVisible();
  const shareUrl = (await link.getAttribute("href"))!;

  const stranger = await browser.newContext();
  const shared = await stranger.newPage();
  await shared.goto(shareUrl);
  await expect(shared.getByRole("heading", { level: 2, name: title })).toBeVisible();
  await expect(shared.getByText("Read only")).toBeVisible();
  await expect(shared.locator("canvas")).toBeVisible();
  await expect(shared.getByRole("button", { name: "Send" })).toHaveCount(0);
  await stranger.close();
});

test("describe a chart in your own words", async ({ page }) => {
  await uploadRevenue(page);

  await page
    .getByLabel("e.g. revenue by region as a doughnut, biggest first")
    .fill("revenue by region as a horizontal bar");
  await page.getByRole("button", { name: "Draw it" }).click();

  await expect(
    page.getByRole("heading", { level: 2, name: "revenue by region as a horizontal bar" }),
  ).toBeVisible();
  await expect(specPanel(page)).toContainText('"chartType": "horizontalBar"');

  await page.getByRole("button", { name: "Back to suggestions" }).click();
  await expect(page.getByRole("heading", { name: "Three charts worth a look" })).toBeVisible();
});

test("a chart whose filters match nothing offers to drop them", async ({ page }) => {
  await uploadRevenue(page);

  await page
    .getByLabel("e.g. revenue by region as a doughnut, biggest first")
    .fill("nothing at all");
  await page.getByRole("button", { name: "Draw it" }).click();
  await expect(page.getByText("Nothing left to plot")).toBeVisible();

  await page.getByRole("button", { name: "Drop the filters" }).click();
  await expect(page.locator("canvas")).toBeVisible();
  await expect(specPanel(page)).toContainText('"filters": []');
});

test.describe("rejected files", () => {
  test("a spreadsheet renamed to .csv", async ({ page }) => {
    await page.goto("/analyze");
    // The first bytes of an .xlsx: a zip archive's local file header.
    const zipHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);
    const xlsx = Buffer.concat([zipHeader, Buffer.alloc(512, 7)]);
    await page
      .getByLabel("CSV file")
      .setInputFiles({ name: "exports-q4.csv", mimeType: "text/csv", buffer: xlsx });

    await expect(page.getByRole("heading", { name: "That file could not be read" })).toBeVisible();
    await page.getByRole("button", { name: "Pick another file" }).click();
    await expect(page.getByRole("heading", { name: "Start with a CSV" })).toBeVisible();
  });

  test("a file over 5 MB is refused before it is sent", async ({ page }) => {
    await page.goto("/analyze");
    let uploaded = false;
    page.on("request", (r) => {
      if (r.url().endsWith("/api/backend/datasets")) uploaded = true;
    });

    const big = Buffer.alloc(5 * 1024 * 1024 + 1, "a");
    await page
      .getByLabel("CSV file")
      .setInputFiles({ name: "big.csv", mimeType: "text/csv", buffer: big });

    await expect(page.getByRole("heading", { name: "That file is too large" })).toBeVisible();
    expect(uploaded).toBe(false);
  });

  test("the api refuses an oversized upload that skips the browser check", async ({
    request,
    baseURL,
  }) => {
    const response = await request.post("/api/backend/datasets", {
      headers: { origin: baseURL! },
      multipart: {
        file: {
          name: "big.csv",
          mimeType: "text/csv",
          buffer: Buffer.alloc(5 * 1024 * 1024 + 1024, "a"),
        },
      },
    });
    expect(response.status()).toBe(413);
    expect((await response.json()).error).toBe("FILE_TOO_LARGE");
  });
});
