/**
 * Keeps invented numbers out of the insights. The AI writes the insights from what its
 * query_data calls returned; this checks that every number it wrote can be traced back to
 * that evidence, so a figure the model made up never reaches the page.
 *
 * A written number is supported when, to the precision its digits show, it is:
 * - a number the AI was given: a query result, a total or a share the tool worked out, a
 *   group label such as "2024-03", a sample row's cell, or the dataset summary (row count,
 *   distinct and missing counts);
 * - worked out from two figures the same insight also states: their difference or sum (values
 *   are kept without their sign, so a rise from -0.357 to 0.688 is one), how many times one is the other, or the change from one to the other as a percentage. Shares of a
 *   total come from the tool, never from the model's own division;
 * - a small count (0 to 12), as in "the top 3 regions" or "over 12 months".
 *
 * Asking for both figures in the sentence keeps the check tight: with dozens of values seen,
 * some pair divides to nearly any percentage, so a ratio of figures the reader cannot see is
 * not evidence of anything.
 */

/**
 * A number as an insight writes it, e.g. "1.2 million", "38%", "95,000". With a scale word,
 * `digits` is the number as written before it: "15,041 thousand" for a column already in
 * thousands states the 15,041 the data holds.
 */
export type WrittenNumber = {
  text: string;
  value: number;
  tolerance: number;
  digits?: WrittenNumber;
  /** Written with % or "percent", so it may state a share the data keeps as a fraction. */
  percent?: boolean;
};

const SCALES: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  million: 1e6,
  bn: 1e9,
  b: 1e9,
  billion: 1e9,
};

// Grouped thousands (1,234,500) or plain digits, an optional fraction, then an optional scale
// word or percent sign. A comma not followed by exactly three digits ends the number, so a
// list such as "3, 4" stays two numbers.
const NUMBER =
  /(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(\s*(?:%|percentage points?\b|percent\b|k\b|thousand\b|million\b|m\b|bn\b|b\b|billion\b))?/gi;

const SMALL_COUNT = 12;

export function writtenNumbers(text: string): WrittenNumber[] {
  const found: WrittenNumber[] = [];
  for (const match of text.matchAll(NUMBER)) {
    const digits = match[1];
    const suffix = (match[2] ?? "").trim().toLowerCase();
    const scale = SCALES[suffix] ?? 1;
    const plain = digits.replace(/,/g, "");
    const value = Number(plain) * scale;
    const decimals = plain.includes(".") ? plain.split(".")[1].length : 0;
    // How precisely the digits pin the value: one unit of the last digit written, and for a
    // round number such as 95,000 the zeros it was rounded to (but never a tenth of itself).
    const precision = (s: number) => {
      const zeros = decimals === 0 ? (/0+$/.exec(plain)?.[0].length ?? 0) : 0;
      const unit = 10 ** -decimals * s;
      return zeros > 0 ? Math.max(unit, Math.min(10 ** zeros * s, (Number(plain) * s) / 10)) : unit;
    };
    const text = match[0].trim();
    found.push({
      text,
      value,
      tolerance: precision(scale),
      ...(scale !== 1 ? { digits: { text, value: Number(plain), tolerance: precision(1) } } : {}),
      ...(suffix === "%" || suffix.startsWith("percent") ? { percent: true } : {}),
    });
  }
  return found;
}

/**
 * Written digits round the true value, or cut it ("5,323" for 5,323.82, which models write
 * often), so it lies within one unit of them.
 */
const near = (n: WrittenNumber, candidate: number): boolean =>
  Math.abs(Math.abs(candidate) - n.value) < n.tolerance - 1e-9 ||
  (n.digits !== undefined && near(n.digits, candidate));

/** What the AI was shown, collected as it queries; then asked about each insight. */
export class Evidence {
  private readonly values = new Set<number>();
  private readonly labels = new Set<number>();

  /** A quantity: a query result, a total, a share, or a count from the dataset summary. */
  addValue(value: number | null | undefined) {
    if (typeof value === "number" && Number.isFinite(value)) this.values.add(Math.abs(value));
  }

  /**
   * Text such as a group label "2024-Q1" or a sample cell: its numbers may be quoted as is. A
   * label that is just two digits, such as model year "70", may be a year written out ("1970").
   */
  addLabel(label: string) {
    for (const n of writtenNumbers(label)) this.labels.add(n.value);
    if (/^\d{2}$/.test(label.trim())) this.addShortYear(label.trim());
  }

  private addShortYear(short: string) {
    this.labels.add(1900 + Number(short));
    this.labels.add(2000 + Number(short));
  }

  /**
   * A column name such as "2015_murders" or "fatalities_85_99": its numbers may be quoted, and
   * a two-digit one is often a year, which an insight writes out ("1985–99").
   */
  addColumnName(name: string) {
    // Words of their own, so the scale in "per_100k" reads as 100,000.
    this.addLabel(name.replace(/_/g, " "));
    for (const short of name.match(/(?<!\d)\d{2}(?!\d)/g) ?? []) this.addShortYear(short);
  }

  /** The numbers in an insight that nothing the AI saw supports. Empty means it passes. */
  unsupported(insight: string): string[] {
    const written = writtenNumbers(insight);
    // The quantities this insight states outright: the figures a worked-out number may use.
    const stated: number[] = [];
    const open: WrittenNumber[] = [];
    for (const n of written) {
      // A share column such as ShareWomen holds 0.795, which an insight writes as 79.5%.
      const matches = [...this.values].flatMap((v) =>
        near(n, v) ? [v] : n.percent && near(n, v * 100) ? [v * 100] : [],
      );
      stated.push(...matches);
      const direct =
        matches.length > 0 ||
        (Number.isInteger(n.value) && n.value <= SMALL_COUNT) ||
        [...this.labels].some((v) => near(n, v) || (n.percent === true && near(n, v * 100)));
      if (!direct) open.push(n);
    }
    return open.filter((n) => !workedOut(n, stated)).map((n) => n.text);
  }
}

/**
 * Each currency sign and what names it in the data: the sign itself, its code, or its name.
 * A code counts only as a word of its own ("price_eur", "Spending_USD"), so "Europe" is no euro.
 */
const CURRENCIES: [sign: string, named: RegExp][] = [
  ["$", /\$|(?<![a-z])usd(?![a-z])|dollars?(?![a-z])/i],
  ["€", /€|(?<![a-z])eur(?![a-z])|euros?(?![a-z])/i],
  ["£", /£|(?<![a-z])gbp(?![a-z])|pounds? sterling/i],
  ["¥", /¥|(?<![a-z])(?:jpy|cny|yen|yuan)(?![a-z])/i],
];

/**
 * The insight without any currency sign that `context` (the column names, sample cells and
 * group labels) never names: a model writes "$110,000" for a salary column that states no
 * unit, and a unit the data does not state is invented.
 */
export function withoutUnnamedCurrency(insight: string, context: string): string {
  let out = insight;
  for (const [sign, named] of CURRENCIES) {
    if (out.includes(sign) && !named.test(context)) out = out.replaceAll(sign, "");
  }
  return out;
}

/** A difference, a sum, a multiple or a percentage change between two figures the insight states. */
function workedOut(n: WrittenNumber, stated: number[]): boolean {
  for (const a of stated) {
    for (const b of stated) {
      if (a === b) continue;
      if (near(n, a - b) || near(n, a + b)) return true;
      if (b === 0) continue;
      if (near(n, a / b) || near(n, (a / b - 1) * 100)) return true;
    }
  }
  return false;
}
