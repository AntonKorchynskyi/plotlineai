import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ChartSpecModelSchema,
  ChartSpecSchema,
  MAX_FILTER_VALUE_LENGTH,
  MAX_IN_VALUES,
  toChartSpec,
} from "@/lib/chart-spec";

/**
 * The fixtures the backend's ChartSpecContractTest reads too, so the Zod schema and the Java
 * record are held to one set of cases.
 */
type Fixture = { name: string; spec: unknown };
const fixtures = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../../backend/src/test/resources/contracts/chart-spec-fixtures.json"),
    "utf8",
  ),
) as { valid: Fixture[]; invalid: Fixture[] };

const count = { column: null, aggregation: "count" };
const base = { chartType: "bar", title: "T", dimension: { column: "r" }, measures: [count] };
const withFilter = (value: unknown, op = "eq") => ({
  ...base,
  filters: [{ column: "a", op, value }],
});

describe("ChartSpecSchema, the contract mirror of ChartSpec.java", () => {
  it("has fixtures to check against", () => {
    expect(fixtures.valid.length).toBeGreaterThan(0);
    expect(fixtures.invalid.length).toBeGreaterThan(0);
  });

  it.each(fixtures.valid.map((f) => [f.name, f.spec]))("accepts %s", (_name, spec) => {
    expect(ChartSpecSchema.safeParse(spec).success).toBe(true);
  });

  it.each(fixtures.invalid.map((f) => [f.name, f.spec]))("rejects %s", (_name, spec) => {
    expect(ChartSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("maps fields exactly", () => {
    const spec = ChartSpecSchema.parse({
      chartType: "horizontalBar",
      title: "T",
      dimension: { column: "joined", bucket: "week" },
      measures: [{ column: "revenue", aggregation: "max" }],
      limit: 5,
    });
    expect(spec.chartType).toBe("horizontalBar");
    expect(spec.dimension.bucket).toBe("week");
    expect(spec.measures[0].aggregation).toBe("max");
    expect(spec.limit).toBe(5);
  });

  it("rejects a fractional limit, which the Java Integer cannot hold", () => {
    expect(ChartSpecSchema.safeParse({ ...base, limit: 2.5 }).success).toBe(false);
  });

  describe("filter values, capped here so bad model output never reaches the api", () => {
    it("accepts a string, a number, and an array of strings", () => {
      expect(ChartSpecSchema.safeParse(withFilter("north")).success).toBe(true);
      expect(ChartSpecSchema.safeParse(withFilter(10, "gte")).success).toBe(true);
      expect(ChartSpecSchema.safeParse(withFilter(["a", "b"], "in")).success).toBe(true);
    });

    it("mirrors the validator's per-value length cap", () => {
      const atCap = "v".repeat(MAX_FILTER_VALUE_LENGTH);
      expect(ChartSpecSchema.safeParse(withFilter(atCap)).success).toBe(true);
      expect(ChartSpecSchema.safeParse(withFilter(atCap + "v")).success).toBe(false);
      expect(ChartSpecSchema.safeParse(withFilter([atCap + "v"], "in")).success).toBe(false);
    });

    it("mirrors the validator's in-list size cap", () => {
      const list = (n: number) => Array.from({ length: n }, (_, i) => `v${i}`);
      expect(ChartSpecSchema.safeParse(withFilter(list(MAX_IN_VALUES), "in")).success).toBe(true);
      expect(ChartSpecSchema.safeParse(withFilter(list(MAX_IN_VALUES + 1), "in")).success).toBe(
        false,
      );
      expect(ChartSpecSchema.safeParse(withFilter([], "in")).success).toBe(false);
    });

    it("rejects values of other shapes", () => {
      expect(ChartSpecSchema.safeParse(withFilter(true)).success).toBe(false);
      expect(ChartSpecSchema.safeParse(withFilter({ x: 1 })).success).toBe(false);
      expect(ChartSpecSchema.safeParse(withFilter([1, 2], "in")).success).toBe(false);
    });
  });
});

/**
 * Reduces a JSON schema to the parts both ChartSpec schemas must agree on: property names,
 * enum values and types, at every depth. Bounds and nullability are deliberately left out,
 * because those are exactly where the two schemas are allowed to differ.
 */
function shape(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(shape);
  if (node === null || typeof node !== "object") return node;
  const n = node as Record<string, unknown>;
  const variants = (n.anyOf ?? n.oneOf) as unknown[] | undefined;
  if (variants) {
    const nonNull = variants.filter((v) => (v as { type?: string }).type !== "null");
    return nonNull.length === 1 ? shape(nonNull[0]) : { anyOf: nonNull.map(shape) };
  }
  const out: Record<string, unknown> = {};
  if (Array.isArray(n.type)) {
    // Zod spells some nullable primitives as type: ["string", "null"] rather than anyOf.
    const types = n.type.filter((t) => t !== "null");
    out.type = types.length === 1 ? types[0] : types;
  } else if (n.type) {
    out.type = n.type;
  }
  if (n.enum) out.enum = n.enum;
  if (n.items) out.items = shape(n.items);
  if (n.properties) {
    out.properties = Object.fromEntries(
      Object.entries(n.properties as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, shape(v)]),
    );
  }
  return out;
}

describe("the two schemas", () => {
  it("describe the same property tree, types and enums", () => {
    expect(shape(z.toJSONSchema(ChartSpecModelSchema))).toEqual(
      shape(z.toJSONSchema(ChartSpecSchema)),
    );
  });

  it("would notice a property or an enum value going missing on one side", () => {
    const contract = shape(z.toJSONSchema(ChartSpecSchema));
    expect(shape(z.toJSONSchema(ChartSpecModelSchema.omit({ limit: true })))).not.toEqual(
      contract,
    );
    expect(
      shape(
        z.toJSONSchema(
          ChartSpecModelSchema.extend({ chartType: z.enum(["bar", "line"]) }),
        ),
      ),
    ).not.toEqual(contract);
  });
});

describe("ChartSpecModelSchema, the shape handed to the provider", () => {
  it("requires every optional field to be present, as strict structured outputs demand", () => {
    // Optional properties are not allowed in strict mode: absent must be spelled null.
    expect(ChartSpecModelSchema.safeParse(base).success).toBe(false);
  });

  it("accepts the same spec with every optional field spelled as null", () => {
    const spec = {
      chartType: "bar",
      stacked: null,
      title: "T",
      dimension: { column: "r", bucket: null },
      measures: [{ column: null, aggregation: "count", label: null }],
      breakdown: null,
      filters: null,
      sort: null,
      limit: null,
    };
    expect(ChartSpecModelSchema.safeParse(spec).success).toBe(true);
  });

  it("still rejects unknown keys and unknown enum values", () => {
    const spec = {
      chartType: "banana",
      stacked: null,
      title: "T",
      dimension: { column: "r", bucket: null },
      measures: [{ column: null, aggregation: "count", label: null }],
      breakdown: null,
      filters: null,
      sort: null,
      limit: null,
    };
    expect(ChartSpecModelSchema.safeParse(spec).success).toBe(false);
    expect(
      ChartSpecModelSchema.safeParse({ ...spec, chartType: "bar", evil: 1 }).success,
    ).toBe(false);
  });
});

describe("toChartSpec", () => {
  const modelOutput = {
    chartType: "bar",
    stacked: null,
    title: "Revenue by region",
    dimension: { column: "region", bucket: null },
    measures: [{ column: "revenue", aggregation: "sum", label: null }],
    breakdown: null,
    filters: null,
    sort: { by: "measure", direction: "desc" },
    limit: null,
  };

  it("drops the nulls strict mode forced, leaving a tidy spec", () => {
    expect(toChartSpec(modelOutput)).toEqual({
      chartType: "bar",
      title: "Revenue by region",
      dimension: { column: "region" },
      measures: [{ column: "revenue", aggregation: "sum" }],
      sort: { by: "measure", direction: "desc" },
    });
  });

  it("keeps a count measure meaningful after its null column is dropped", () => {
    const spec = toChartSpec({
      ...modelOutput,
      measures: [{ column: null, aggregation: "count", label: null }],
    });
    expect(spec.measures).toEqual([{ aggregation: "count" }]);
    expect(ChartSpecSchema.safeParse(spec).success).toBe(true);
  });

  it("enforces the contract bounds the model schema leaves out", () => {
    expect(() => toChartSpec({ ...modelOutput, title: "x".repeat(121) })).toThrow();
    expect(() => toChartSpec({ ...modelOutput, measures: [] })).toThrow();
    expect(() => toChartSpec({ ...modelOutput, limit: 500 })).toThrow();
  });

  it("returns specs the shared fixtures would accept", () => {
    for (const { spec } of fixtures.valid) {
      expect(ChartSpecSchema.safeParse(toChartSpec(spec)).success).toBe(true);
    }
  });
});
