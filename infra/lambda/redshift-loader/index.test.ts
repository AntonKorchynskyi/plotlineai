import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createHandler,
  loadDays,
  splitStatements,
  type LoaderDeps,
  type StatementState,
  type Warehouse,
} from "./index.js";

const DDL = ["CREATE TABLE IF NOT EXISTS public.events (dt DATE)", "CREATE OR REPLACE VIEW public.v AS SELECT 1"];

type Fake = {
  deps: LoaderDeps;
  batches: string[][];
  listed: string[];
  slept: number[];
};

/**
 * A warehouse whose statement goes through the given states, one per DescribeStatement, and an
 * archive with objects for the given days (every day unless told otherwise).
 */
const fake = ({
  states = [{ status: "FINISHED" }] as StatementState[],
  archived = (_day: string): boolean => true,
  rows = 42,
  now = new Date("2026-10-05T12:00:00Z"),
  maxWaitMs = 60_000,
} = {}): Fake => {
  const batches: string[][] = [];
  const listed: string[] = [];
  const slept: number[] = [];
  let described = 0;
  let clock = now.getTime();
  const warehouse: Warehouse = {
    run: async (sqls) => {
      batches.push(sqls);
      return "stmt-1";
    },
    describe: async (id) => {
      expect(id).toBe("stmt-1");
      const state = states[Math.min(described, states.length - 1)];
      described += 1;
      return state;
    },
    count: async (id) => {
      expect(id).toBe(`stmt-1:${batches[0].length}`);
      return rows;
    },
  };
  return {
    batches,
    listed,
    slept,
    deps: {
      statements: DDL,
      bucket: "analytics-bucket",
      warehouse,
      hasObjects: async (prefix) => {
        listed.push(prefix);
        return archived(prefix.slice("events/dt=".length, -1));
      },
      sleep: async (ms) => {
        slept.push(ms);
        clock += ms;
      },
      now: () => new Date(clock),
      maxWaitMs,
    },
  };
};

const copy = (day: string) =>
  `COPY public.events FROM 's3://analytics-bucket/events/dt=${day}/' IAM_ROLE default ` +
  "FORMAT JSON 'auto' GZIP DATEFORMAT 'auto' TIMEFORMAT 'auto'";

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("splitStatements", () => {
  it("splits on semicolons that end a line and drops comment-only pieces", () => {
    const sql = [
      "-- header",
      "",
      "CREATE TABLE a (x INT);",
      "",
      "-- the table",
      "CREATE TABLE t (",
      "  a INT -- not the end; still the table",
      ");",
      "-- trailing comment",
      "",
    ].join("\n");
    expect(splitStatements(sql)).toEqual([
      "-- header\n\nCREATE TABLE a (x INT)",
      "-- the table\nCREATE TABLE t (\n  a INT -- not the end; still the table\n)",
    ]);
  });

  it("handles Windows line endings", () => {
    expect(splitStatements("SELECT 1;\r\nSELECT 2;\r\n")).toEqual(["SELECT 1", "SELECT 2"]);
  });
});

describe("createHandler: which days", () => {
  it("loads the 7 UTC days before the scheduled time, so a retry loads the same days", async () => {
    const f = fake();
    const result = await createHandler(f.deps)({ scheduledTime: "2026-10-05T06:00:00Z" });
    expect(result.days).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
    expect(f.listed).toHaveLength(7);
  });

  it("crosses year boundaries", async () => {
    const f = fake();
    const result = await createHandler(f.deps)({ scheduledTime: "2027-01-02T06:00:00Z" });
    expect(result.days[0]).toBe("2026-12-26");
    expect(result.days.at(-1)).toBe("2027-01-01");
  });

  it("loads the given day, for backfills and same-day checks", async () => {
    const f = fake();
    const result = await createHandler(f.deps)({ day: "2026-09-30" });
    expect(f.listed).toEqual(["events/dt=2026-09-30/"]);
    expect(result).toEqual({ days: ["2026-09-30"], loaded: ["2026-09-30"], rows: 42 });
  });

  it("loads the last 7 days when invoked with nothing", async () => {
    const f = fake({ now: new Date("2026-10-05T00:30:00Z") });
    const result = await createHandler(f.deps)({});
    expect(result.days.at(-1)).toBe("2026-10-04");
    expect(result.days).toHaveLength(7);
  });

  it.each(["2026-02-30", "2026-9-30", "2026-09-30'; DROP TABLE x; --", "yesterday", ""])(
    "refuses %j before touching anything",
    async (day) => {
      const f = fake();
      await expect(createHandler(f.deps)({ day })).rejects.toThrow(/day/);
      expect(f.listed).toEqual([]);
      expect(f.batches).toEqual([]);
    },
  );

  it("refuses a scheduled time that is not a time", async () => {
    const f = fake();
    await expect(createHandler(f.deps)({ scheduledTime: "soon" })).rejects.toThrow(/scheduledTime/);
  });
});

describe("loadDays", () => {
  it("applies the DDL, then replaces the archived days, in one batch", async () => {
    const f = fake({ archived: (day) => day !== "2026-10-02" });
    const result = await loadDays(["2026-10-01", "2026-10-02", "2026-10-03"], f.deps);
    expect(f.batches).toEqual([
      [
        ...DDL,
        "DELETE FROM public.events WHERE dt IN ('2026-10-01', '2026-10-03')",
        copy("2026-10-01"),
        copy("2026-10-03"),
        "SELECT COUNT(*) FROM public.events WHERE dt IN ('2026-10-01', '2026-10-03')",
      ],
    ]);
    expect(result).toEqual({
      days: ["2026-10-01", "2026-10-02", "2026-10-03"],
      loaded: ["2026-10-01", "2026-10-03"],
      rows: 42,
    });
  });

  it("does not start Redshift at all when the archive has nothing for those days", async () => {
    const f = fake({ archived: () => false });
    const result = await loadDays(["2026-10-01", "2026-10-02"], f.deps);
    expect(f.batches).toEqual([]);
    expect(result).toEqual({ days: ["2026-10-01", "2026-10-02"], loaded: [], rows: 0 });
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('"event":"analytics_load_skipped"'));
  });

  it("waits for the batch to finish, backing off between checks", async () => {
    const f = fake({
      states: [{ status: "SUBMITTED" }, { status: "PICKED" }, { status: "STARTED" }, { status: "FINISHED" }],
    });
    const result = await loadDays(["2026-10-02"], f.deps);
    expect(result.rows).toBe(42);
    expect(f.slept).toEqual([1000, 1500, 2250]);
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('"event":"analytics_load_done"'));
  });

  it.each(["FAILED", "ABORTED"])("throws with Redshift's error when the batch is %s", async (status) => {
    const f = fake({ states: [{ status, error: "S3ServiceException: Access Denied" }] });
    await expect(loadDays(["2026-10-02"], f.deps)).rejects.toThrow(
      `load of 2026-10-02 ${status}: S3ServiceException: Access Denied`,
    );
  });

  it("gives up once the wait runs out", async () => {
    const f = fake({ states: [{ status: "STARTED" }], maxWaitMs: 5000 });
    await expect(loadDays(["2026-10-02"], f.deps)).rejects.toThrow(/still running/);
  });
});
