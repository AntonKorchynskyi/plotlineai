import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import gallery from "@/test/fixtures/gallery.json";
import type { GalleryExample } from "@/lib/gallery";

const examples = gallery as unknown as GalleryExample[];

const { getGallery } = vi.hoisted(() => ({ getGallery: vi.fn() }));

vi.mock("@/lib/gallery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/gallery")>()),
  getGallery,
}));

// The canvas never draws under jsdom; ChartRenderer is covered by its own test.
vi.mock("@/components/ChartRenderer", () => ({
  default: ({ data, height }: { data: { title: string }; height: number }) => (
    <div data-testid="chart" data-title={data.title} data-height={height} />
  ),
}));

const renderPage = async () => {
  const LandingPage = (await import("@/app/page")).default;
  render(await LandingPage());
};

beforeEach(() => getGallery.mockReset());
afterEach(() => vi.clearAllMocks());

describe("landing page", () => {
  describe("with the gallery available", () => {
    beforeEach(() => getGallery.mockResolvedValue(examples));

    it("shows the hero", async () => {
      await renderPage();

      expect(
        screen.getByRole("heading", { name: /hand it a spreadsheet/i, level: 1 }),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Upload a CSV" })).toHaveAttribute(
        "href",
        "/analyze",
      );
      expect(screen.getByRole("link", { name: /see six examples/i })).toHaveAttribute(
        "href",
        "#gallery",
      );
    });

    it("draws the monthly signups example in the hero card", async () => {
      await renderPage();

      const charts = screen.getAllByTestId("chart");
      expect(charts[0]).toHaveAttribute("data-title", "Signups per month");
      expect(charts[0]).toHaveAttribute("data-height", "240");
    });

    it("renders all six examples, in the order the api returned them", async () => {
      await renderPage();

      const titles = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
      expect(titles).toEqual(examples.map((e) => e.title));
    });

    it("draws a chart for every card plus the hero", async () => {
      await renderPage();
      expect(screen.getAllByTestId("chart")).toHaveLength(examples.length + 1);
    });

    it("badges each card with its chart type, reading stacked bars correctly", async () => {
      await renderPage();

      const card = screen
        .getByRole("heading", { name: "Sales by category per quarter", level: 3 })
        .closest("article") as HTMLElement;
      expect(within(card).getByText("stacked bar")).toBeInTheDocument();
    });

    it("links Download CSV through the browser proxy, as a plain download", async () => {
      await renderPage();

      const links = screen.getAllByRole("link", { name: /download csv/i });
      expect(links).toHaveLength(examples.length);
      expect(links.map((a) => a.getAttribute("href"))).toEqual(
        examples.map((e) => `/api/backend${e.csvPath}`),
      );
      for (const link of links) expect(link).toHaveAttribute("download");
    });

    it("shows each example's description", async () => {
      await renderPage();
      for (const example of examples) {
        expect(screen.getByText(example.description)).toBeInTheDocument();
      }
    });

    it("carries no Try your own action; the hero's Upload a CSV is the only way in", async () => {
      await renderPage();
      expect(screen.queryByRole("link", { name: /try your own/i })).not.toBeInTheDocument();
    });

    it("carries no kicker tag above the hero heading", async () => {
      await renderPage();
      expect(screen.queryByText(/csv in, chart out/i)).not.toBeInTheDocument();
    });

    it("names the endpoint the gallery came from", async () => {
      await renderPage();
      expect(screen.getByText("GET /api/backend/gallery")).toBeInTheDocument();
    });
  });

  describe("when the backend is unreachable", () => {
    beforeEach(() => getGallery.mockResolvedValue(null));

    it("still renders the hero copy and call to action", async () => {
      await renderPage();

      expect(
        screen.getByRole("heading", { name: /hand it a spreadsheet/i, level: 1 }),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Upload a CSV" })).toHaveAttribute(
        "href",
        "/analyze",
      );
    });

    it("draws no charts and explains why", async () => {
      await renderPage();

      expect(screen.queryAllByTestId("chart")).toHaveLength(0);
      expect(screen.getByText(/examples are offline/i)).toBeInTheDocument();
      expect(screen.getByText(/no examples to show/i)).toBeInTheDocument();
    });

    it("does not crash on an empty list either", async () => {
      getGallery.mockResolvedValue([]);
      await renderPage();

      expect(screen.getByText(/no examples to show/i)).toBeInTheDocument();
    });
  });
});
