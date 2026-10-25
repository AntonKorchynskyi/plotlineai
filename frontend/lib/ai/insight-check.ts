/**
 * Keeps invented numbers out of the insights. The AI writes the insights from what its
 * query_data calls returned; this checks that every number it wrote can be traced back to
 * that evidence, so a figure the model made up never reaches the page.
 *
 * A written number is supported when, to the precision its digits show, it is:
 * - a number the AI was given: a query result, a total or a share the tool worked out, a
 *   group label such as "2024-03", a sample row's cell, or the dataset summary (row count,
 *   distinct and missing counts);
 * - worked out from two figures the same insight also states: their difference, how many
 *   times one is the other, or the change from one to the other as a percentage. Shares of a
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
  /(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(\s*(?:%|percent\b|k\b|thousand\b|million\b|m\b|bn\b|b\b|billion\b))?/gi;

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
    });
  }
  return found;
}

/** Written digits round the true value, so it lies within half a unit of them. */
const near = (n: WrittenNumber, candidate: number): boolean =>
  Math.abs(Math.abs(candidate) - n.value) <= n.tolerance / 2 + 1e-9 ||
  (n.digits !== undefined && near(n.digits, candidate));

/** What the AI was shown, collected as it queries; then asked about each insight. */
export class Evidence {
  private readonly values = new Set<number>();
  private readonly labels = new Set<number>();

  /** A quantity: a query result, a total, a share, or a count from the dataset summary. */
  addValue(value: number | null | undefined) {
    if (typeof value === "number" && Number.isFinite(value)) this.values.add(Math.abs(value));
  }

  /** Text such as a group label "2024-Q1" or a sample cell: its numbers may be quoted as is. */
  addLabel(label: string) {
    for (const n of writtenNumbers(label)) this.labels.add(n.value);
  }

  /** The numbers in an insight that nothing the AI saw supports. Empty means it passes. */
  unsupported(insight: string): string[] {
    const written = writtenNumbers(insight);
    // The quantities this insight states outright: the figures a worked-out number may use.
    const stated: number[] = [];
    const open: WrittenNumber[] = [];
    for (const n of written) {
      const matches = [...this.values].filter((v) => near(n, v));
      stated.push(...matches);
      const direct =
        matches.length > 0 ||
        (Number.isInteger(n.value) && n.value <= SMALL_COUNT) ||
        [...this.labels].some((v) => near(n, v));
      if (!direct) open.push(n);
    }
    return open.filter((n) => !workedOut(n, stated)).map((n) => n.text);
  }
}

/** A difference, a multiple or a percentage change between two figures the insight states. */
function workedOut(n: WrittenNumber, stated: number[]): boolean {
  for (const a of stated) {
    for (const b of stated) {
      if (a === b) continue;
      if (near(n, a - b)) return true;
      if (b === 0) continue;
      if (near(n, a / b) || near(n, (a / b - 1) * 100)) return true;
    }
  }
  return false;
}
