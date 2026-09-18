import { z } from "zod";

/**
 * The ChartSpec contract, mirroring com.plotlineai.backend.chart.spec.ChartSpec and its
 * records. Two schemas share one set of enums:
 *
 * - ChartSpecSchema is the contract: shape plus every bound the Java record enforces, and
 *   the validator's filter-value caps so bad model output is rejected here first.
 * - ChartSpecModelSchema is what the provider sees. OpenAI strict structured outputs allow
 *   no optional properties (absent must be spelled null) and not every bound keyword, so it
 *   carries the shape only; the prompt states the bounds and toChartSpec enforces them.
 *
 * lib/chart-spec.test.ts holds both to the fixtures the Java test reads, and checks that the
 * two schemas describe the same property tree.
 */

export const CHART_TYPES = [
  "bar",
  "horizontalBar",
  "line",
  "area",
  "pie",
  "doughnut",
  "scatter",
  "bubble",
] as const;
export const AGGREGATIONS = ["sum", "avg", "min", "max", "count", "none"] as const;
export const TIME_BUCKETS = ["day", "week", "month", "quarter", "year"] as const;
export const FILTER_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "in"] as const;
export const SORT_BY = ["dimension", "measure"] as const;
export const SORT_DIRECTIONS = ["asc", "desc"] as const;

export const MAX_TITLE_LENGTH = 120;
export const MAX_LABEL_LENGTH = 120;
export const MIN_MEASURES = 1;
export const MAX_MEASURES = 4;
export const MAX_FILTERS = 5;
export const MIN_LIMIT = 1;
export const MAX_LIMIT = 100;
/** ChartSpecValidator.MAX_FILTER_VALUE_LENGTH */
export const MAX_FILTER_VALUE_LENGTH = 256;
/** ChartSpecValidator.MAX_IN_VALUES */
export const MAX_IN_VALUES = 50;

const notBlank = (max: number) =>
  z.string().max(max).regex(/\S/, "must not be blank");

const filterValue = z.union([
  z.string().max(MAX_FILTER_VALUE_LENGTH),
  z.number(),
  z.array(z.string().max(MAX_FILTER_VALUE_LENGTH)).min(1).max(MAX_IN_VALUES),
]);

export const ChartSpecSchema = z.strictObject({
  chartType: z.enum(CHART_TYPES),
  stacked: z.boolean().nullish(),
  title: notBlank(MAX_TITLE_LENGTH),
  dimension: z.strictObject({
    column: z.string().regex(/\S/, "must not be blank"),
    bucket: z.enum(TIME_BUCKETS).nullish(),
  }),
  measures: z
    .array(
      z.strictObject({
        column: z.string().nullish(),
        aggregation: z.enum(AGGREGATIONS),
        label: z.string().max(MAX_LABEL_LENGTH).nullish(),
      }),
    )
    .min(MIN_MEASURES)
    .max(MAX_MEASURES),
  breakdown: z
    .strictObject({ column: z.string().regex(/\S/, "must not be blank") })
    .nullish(),
  filters: z
    .array(
      z.strictObject({
        column: z.string().regex(/\S/, "must not be blank"),
        op: z.enum(FILTER_OPS),
        value: filterValue,
      }),
    )
    .max(MAX_FILTERS)
    .nullish(),
  sort: z
    .strictObject({ by: z.enum(SORT_BY), direction: z.enum(SORT_DIRECTIONS) })
    .nullish(),
  limit: z.number().int().min(MIN_LIMIT).max(MAX_LIMIT).nullish(),
});

export type ChartSpec = z.infer<typeof ChartSpecSchema>;

export const ChartSpecModelSchema = z.strictObject({
  chartType: z.enum(CHART_TYPES),
  stacked: z.boolean().nullable(),
  title: z.string(),
  dimension: z.strictObject({
    column: z.string(),
    bucket: z.enum(TIME_BUCKETS).nullable(),
  }),
  measures: z.array(
    z.strictObject({
      column: z.string().nullable(),
      aggregation: z.enum(AGGREGATIONS),
      label: z.string().nullable(),
    }),
  ),
  breakdown: z.strictObject({ column: z.string() }).nullable(),
  filters: z
    .array(
      z.strictObject({
        column: z.string(),
        op: z.enum(FILTER_OPS),
        value: z.union([z.string(), z.number(), z.array(z.string())]),
      }),
    )
    .nullable(),
  sort: z.strictObject({ by: z.enum(SORT_BY), direction: z.enum(SORT_DIRECTIONS) }).nullable(),
  limit: z.number().int().nullable(),
});

/** Drops null-valued properties at every depth. Null array elements are kept, so they fail. */
function dropNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropNulls);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== null)
        .map(([k, v]) => [k, dropNulls(v)]),
    );
  }
  return value;
}

/**
 * Turns model output into a contract ChartSpec: drops the nulls strict mode forced, then
 * enforces every bound the model schema left out. Throws a ZodError when the output breaks
 * the contract.
 */
export function toChartSpec(output: unknown): ChartSpec {
  return ChartSpecSchema.parse(dropNulls(output));
}
