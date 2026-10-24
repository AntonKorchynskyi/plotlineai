import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "./fixtures";

const APP_FILE = (name: string) => path.resolve(import.meta.dirname, "../../frontend/app", name);

test("the landing page draws all six gallery charts", async ({ page }) => {
  await page.goto("/");

  const cards = page.locator("#gallery article");
  await expect(cards).toHaveCount(6);
  for (const card of await cards.all()) {
    await expect(card.locator("canvas")).toBeVisible();
  }
});

test("the gallery offers no CSV downloads", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#gallery article")).toHaveCount(6);
  await expect(page.getByRole("link", { name: /download csv/i })).toHaveCount(0);
  await expect(page.getByText("/api/")).toHaveCount(0);
});

test("the browser tab shows the brand mark", async ({ page, request }) => {
  await page.goto("/");

  const svgHref = await page.locator('link[rel="icon"][type="image/svg+xml"]').getAttribute("href");
  expect(svgHref).toMatch(/^\/icon\.svg/);
  const svg = await request.get(svgHref!);
  expect(svg.headers()["content-type"]).toContain("image/svg+xml");
  expect(await svg.text()).toContain('fill="#c67139"');

  const appleHref = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
  const apple = await request.get(appleHref!);
  expect(apple.headers()["content-type"]).toBe("image/png");

  // Requested by clients that never read the page's links; the brand mark, not Vercel's.
  const ico = await request.get("/favicon.ico");
  expect(ico.ok()).toBe(true);
  expect(await ico.body()).toEqual(await readFile(APP_FILE("favicon.ico")));
});

test("the logo leads home from any page", async ({ page }) => {
  await page.goto("/analyze");
  await page.getByRole("banner").getByRole("link", { name: "PlotlineAI" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("the hero sends people to the analyze flow", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /upload a csv/i }).click();
  await expect(page).toHaveURL(/\/analyze$/);
  await expect(page.getByRole("heading", { name: "Start with a CSV" })).toBeVisible();
});

test("nothing widens the page on a small phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const path of ["/", "/analyze"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, `${path} scrolls sideways`).toBe(0);
  }

  // The hero's longest word must shrink with the column rather than overhang it.
  await page.goto("/");
  const headline = page.getByRole("heading", { level: 1 });
  expect(await headline.evaluate((h) => h.scrollWidth - h.clientWidth)).toBe(0);
});
