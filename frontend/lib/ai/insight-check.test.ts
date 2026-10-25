import { describe, expect, it } from "vitest";
import { Evidence, withoutUnnamedCurrency, writtenNumbers } from "@/lib/ai/insight-check";

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

  it("accepts a rise across zero and a sum of two figures the insight states", () => {
    const evidence = new Evidence();
    for (const v of [-0.357, 0.688, 34.2, 28.9]) evidence.addValue(v);

    expect(evidence.unsupported("The mean rose by 1.045, from -0.357 to 0.688.")).toEqual([]);
    expect(evidence.unsupported("Mt (34.2%) and percent (28.9%) together make up 63.1%.")).toEqual([]);
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

  it("accepts the years a column name carries, written out in full", () => {
    const evidence = new Evidence();
    for (const name of ["fatalities_85_99", "fatalities_00_14", "2015_murders"]) evidence.addColumnName(name);
    evidence.addValue(6295);
    evidence.addValue(3109);

    expect(evidence.unsupported("Fatalities fell from 6,295 in 1985–99 to 3,109 in 2000–14.")).toEqual([]);
    expect(evidence.unsupported("Murders rose in 2015.")).toEqual([]);
    expect(evidence.unsupported("Murders rose in 2016.")).toEqual(["2016"]);
  });

  it("accepts a share kept as a fraction written as a percentage", () => {
    const evidence = new Evidence();
    evidence.addValue(0.795);
    evidence.addValue(0.177);

    expect(evidence.unsupported("Health majors are 79.5% women on average.")).toEqual([]);
    expect(evidence.unsupported("Unemployment peaks at 17.7%.")).toEqual([]);
    // Only as a percentage: a bare 79.5 is not the 0.795 it was given.
    expect(evidence.unsupported("Health majors score 79.5.")).toEqual(["79.5"]);
  });

  it("accepts a figure cut rather than rounded, but nothing a whole unit off", () => {
    const evidence = new Evidence();
    evidence.addValue(5323.82);

    expect(evidence.unsupported("Color J averages 5,323.")).toEqual([]);
    expect(evidence.unsupported("Color J averages 5,322.")).toEqual(["5,322"]);
  });

  it("reads percentage points as a percentage, and a fraction threshold as one too", () => {
    const evidence = new Evidence();
    evidence.addValue(0.174);
    evidence.addLabel("0.6");

    expect(evidence.unsupported("The gap averages 17.4 percentage points.")).toEqual([]);
    expect(evidence.unsupported("States where at least 60% voted for him.")).toEqual([]);
  });

  it("accepts a two-digit year label written out in full", () => {
    const evidence = new Evidence();
    evidence.addLabel("70");
    evidence.addLabel("82");

    expect(evidence.unsupported("Mileage rose from 1970 to 1982.")).toEqual([]);
    expect(evidence.unsupported("Mileage rose by 2031.")).toEqual(["2031"]);
  });

  it("accepts the scale a column name states, such as per_100k", () => {
    const evidence = new Evidence();
    evidence.addColumnName("avg_hatecrimes_per_100k_fbi");
    evidence.addValue(10.95);

    expect(evidence.unsupported("DC records 10.95 hate crimes per 100,000 people.")).toEqual([]);
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

describe("withoutUnnamedCurrency", () => {
  it("takes out a currency sign nothing in the data names", () => {
    expect(withoutUnnamedCurrency("The median salary is $110,000.", "Major Median")).toBe(
      "The median salary is 110,000.",
    );
    expect(withoutUnnamedCurrency("The only price is €9.99.", "product price stock Widget")).toBe(
      "The only price is 9.99.",
    );
  });

  it("keeps a sign a column name, its code or a cell names", () => {
    expect(withoutUnnamedCurrency("Spending is $4,388.6.", "Spending_USD")).toBe("Spending is $4,388.6.");
    expect(withoutUnnamedCurrency("Premiums average $886.96.", "Car Insurance Premiums ($)")).toBe(
      "Premiums average $886.96.",
    );
    expect(withoutUnnamedCurrency("It costs €12.", "price_eur")).toBe("It costs €12.");
    expect(withoutUnnamedCurrency("It costs £3.", "price £3.00")).toBe("It costs £3.");
  });

  it("does not take a word that merely starts like a currency code for it", () => {
    expect(withoutUnnamedCurrency("Europe sells €5.", "region Europe sales")).toBe("Europe sells 5.");
  });
});
