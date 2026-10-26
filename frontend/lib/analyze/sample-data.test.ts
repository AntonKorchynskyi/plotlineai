import { describe, expect, it } from "vitest";
import { checkFile } from "@/lib/analyze/client";
import { SAMPLE_FILE_NAME, sampleFile, sampleTable } from "@/lib/analyze/sample-data";

describe("the sample data", () => {
  it("is a file the upload accepts", () => {
    const file = sampleFile();

    expect(file.name).toBe(SAMPLE_FILE_NAME);
    expect(file.type).toBe("text/csv");
    expect(checkFile(file)).toBeNull();
  });

  it("has enough rows to be worth charting, each with every column", () => {
    const { header, rows } = sampleTable();

    expect(header).toEqual(["date", "store", "product", "category", "units", "unit_price", "revenue"]);
    expect(rows.length).toBeGreaterThanOrEqual(100);
    for (const row of rows) expect(row).toHaveLength(header.length);
  });

  it("adds up: revenue is units times the unit price", () => {
    for (const [, , , , units, price, revenue] of sampleTable().rows) {
      expect(revenue).toBe((Number(units) * Number(price)).toFixed(2));
    }
  });
});
