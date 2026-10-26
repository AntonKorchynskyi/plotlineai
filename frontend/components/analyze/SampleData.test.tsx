import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import SampleData from "@/components/analyze/SampleData";
import { SAMPLE_CSV, SAMPLE_FILE_NAME, sampleTable } from "@/lib/analyze/sample-data";

const open = async () => {
  const onUse = vi.fn();
  render(<SampleData onUse={onUse} />);
  await userEvent.click(screen.getByRole("button", { name: /try our sample data/i }));
  return { onUse, dialog: screen.getByRole("dialog", { name: /sample: coffee shop sales/i }) };
};

describe("the sample data link", () => {
  it("keeps the preview shut until asked", () => {
    render(<SampleData onUse={vi.fn()} />);

    expect(screen.getByText(/no csv handy/i)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("previews every row of the sample, under its column names", async () => {
    const { dialog } = await open();
    const { header, rows } = sampleTable();

    expect(within(dialog).getByText(`${rows.length} rows · ${header.length} columns`, { exact: false }))
      .toBeInTheDocument();
    const table = within(dialog).getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual(header);
    // the header row plus one per data row
    expect(within(table).getAllByRole("row")).toHaveLength(rows.length + 1);
  });

  it.each(["Cancel", "Close"])("closes on %s without uploading anything", async (name) => {
    const { onUse, dialog } = await open();

    await userEvent.click(within(dialog).getByRole("button", { name }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onUse).not.toHaveBeenCalled();
  });

  it("hands the sample to the upload as a CSV file", async () => {
    const { onUse, dialog } = await open();

    await userEvent.click(within(dialog).getByRole("button", { name: "Use this data" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onUse).toHaveBeenCalledOnce();
    const file: File = onUse.mock.calls[0][0];
    expect(file.name).toBe(SAMPLE_FILE_NAME);
    expect(file.type).toBe("text/csv");
    expect(await file.text()).toBe(SAMPLE_CSV);
  });
});
