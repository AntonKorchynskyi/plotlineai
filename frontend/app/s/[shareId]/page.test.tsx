import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchShare: vi.fn() }));

vi.mock("@/lib/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/backend")>()),
  fetchShare: mocks.fetchShare,
}));
vi.mock("@/components/ChartRenderer", () => ({
  default: ({ data, height }: { data: { title: string }; height: number }) => (
    <div data-testid="chart" data-title={data.title} data-height={height} />
  ),
}));

const SharePage = (await import("@/app/s/[shareId]/page")).default;

const share = {
  shareId: "8f3c1a7e",
  createdAt: "2026-09-17T10:30:00Z",
  renderedData: {
    chartType: "bar" as const,
    stacked: false,
    title: "Revenue by region",
    labels: ["North"],
    datasets: [{ label: "Revenue", data: [1] }],
  },
};

const show = async (shareId = "8f3c1a7e") =>
  render(await SharePage({ params: Promise.resolve({ shareId }) }));

beforeEach(() => vi.clearAllMocks());

describe("the shared chart page", () => {
  it("draws the stored snapshot, read only", async () => {
    mocks.fetchShare.mockResolvedValue(share);
    await show();

    expect(screen.getByRole("heading", { name: "Revenue by region" })).toBeInTheDocument();
    expect(screen.getByText("Read only")).toBeInTheDocument();
    expect(screen.getByTestId("chart")).toHaveAttribute("data-height", "380");
    expect(mocks.fetchShare).toHaveBeenCalledWith("8f3c1a7e");
  });

  it("shows its own link and says the snapshot outlives the dataset", async () => {
    mocks.fetchShare.mockResolvedValue(share);
    await show();

    expect(screen.getByText("/s/8f3c1a7e")).toBeInTheDocument();
    expect(screen.getByText(/17 September 2026/)).toBeInTheDocument();
    expect(screen.getByText(/keeps working after the dataset expires/i)).toBeInTheDocument();
  });

  it("offers a way to make your own", async () => {
    mocks.fetchShare.mockResolvedValue(share);
    await show();

    expect(screen.getByRole("link", { name: /make your own chart/i })).toHaveAttribute(
      "href",
      "/analyze",
    );
  });

  it("answers an unknown link with a 404 rather than a page saying 200", async () => {
    mocks.fetchShare.mockResolvedValue(null);
    // notFound() throws; Next turns that into a 404 rendering app/not-found.tsx.
    await expect(show("nope")).rejects.toThrow();
  });
});
