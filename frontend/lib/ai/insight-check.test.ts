import { describe, expect, it } from "vitest";
import { Evidence, writtenNumbers } from "@/lib/ai/insight-check";

/** What the AI saw for revenue by region: five totals, the grand total and the shares. */
const revenueEvidence = () => {
  const evidence = new Evidence();
  for (const v of [366350, 339550, 274650, 116100, 47200, 1143850]) evidence.addValue(v);
  for (const share of [32.0, 29.7, 24.0, 10.1, 4.1]) evidence.addValue(share);
  for (const label of ["North America", "Asia Pacific", "Europe", "2024-Q3"]) evidence.addLabel(label);
  return evidence;
};

describe("writtenNumbers", () => {
  it("reads grouped thousands, decimals, percentages and scale words", () => {
    expect(writtenNumbers("366,350 and 4.5 and 38%").map((n) => n.value)).toEqual([366350, 4.5, 38]);
    expect(writtenNumbers("about 1.2 million, or 95k").map((n) => n.value)).toEqual([1_200_000, 95_000]);
  });

  it("keeps a list of small numbers apart rather than reading 3,4 as 34", () => {
    expect(writtenNumbers("months 3, 4 and 5").map((n) => n.value)).toEqual([3, 4, 5]);
  });

  it("is as precise as the digits written", () => {
    const [rounded, exact, decimal] = writtenNumbers("95,000 then 95,321 then 32.0%");
    expect(rounded.tolerance).toBe(1000);
    expect(exact.tolerance).toBe(1);
    expect(decimal.tolerance).toBeCloseTo(0.1);
  });
});

describe("Evidence", () => {
  it("accepts numbers the AI was given, as written or rounded", () => {
    const evidence = revenueEvidence();

    expect(evidence.unsupported("North America leads with 366,350.")).toEqual([]);
    expect(evidence.unsupported("North America brings in about 366,000.")).toEqual([]);
    expect(evidence.unsupported("Revenue totals 1.14 million.")).toEqual([]);
    expect(evidence.unsupported("North America is 32% of all revenue.")).toEqual([]);
  });

  it("accepts a difference, multiple or change between two figures the insight states", () => {
    const evidence = revenueEvidence();

    expect(evidence.unsupported("North America's 366,350 is 7.8 times the Middle East's 47,200.")).toEqual([]);
    expect(evidence.unsupported("366,350 against 339,550: 26,800 ahead, or 7.9% more.")).toEqual([]);
  });

  it("refuses arithmetic on figures the reader cannot see", () => {
    const evidence = revenueEvidence();

    // 366,350 / 47,200 is 7.8, but neither figure is in the sentence.
    expect(evidence.unsupported("North America earns 7.8 times what the Middle East does.")).toEqual(["7.8"]);
  });

  it("refuses a share the model divided out itself, even when some pair happens to fit", () => {
    const evidence = new Evidence();
    for (const v of [48200, 21450, 12800, 9640, 7320, 5180, 104590]) evidence.addValue(v);

    // The four smallest are 33.4% of sessions. 5,180 / 9,640 is 53.7%, which a loose check
    // would have taken for the "about 54%" a real model once wrote here.
    expect(
      evidence.unsupported("Referral (12,800), Social (9,640), Email (7,320) and Paid search (5,180) make up ~54%."),
    ).toEqual(["54%"]);
  });

  it("accepts small counts and the numbers in labels and sample cells", () => {
    const evidence = revenueEvidence();
    evidence.addLabel("4.8");

    expect(evidence.unsupported("The top 3 regions make up most of it.")).toEqual([]);
    expect(evidence.unsupported("Sales peaked in Q3 2024.")).toEqual([]);
    expect(evidence.unsupported("Summit Frame is rated 4.8.")).toEqual([]);
  });

  it("takes a scale word after a figure in a column already counted in thousands", () => {
    const evidence = new Evidence();
    evidence.addValue(15041);

    expect(evidence.unsupported("Total population is 15,041 thousand.")).toEqual([]);
    expect(evidence.unsupported("Total population is about 15 million.")).toEqual(["15 million"]);
  });

  it("names every number nothing supports", () => {
    const evidence = revenueEvidence();

    expect(evidence.unsupported("North America leads with 412,000, and 61% of deals close.")).toEqual([
      "412,000",
      "61%",
    ]);
  });

  it("ignores values that are not numbers", () => {
    const evidence = new Evidence();
    evidence.addValue(null);
    evidence.addValue(Number.NaN);
    evidence.addValue(undefined);

    expect(evidence.unsupported("A total of 500.")).toEqual(["500"]);
  });
});
