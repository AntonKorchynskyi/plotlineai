import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createHandler,
  loadDay,
  splitStatements,
  type LoaderDeps,
  type StatementState,
  type Warehouse,
} from "./index.js";

const DDL = ["CREATE SCHEMA IF NOT EXISTS analytics", "CREATE OR REPLACE VIEW analytics.v AS SELECT 1"];

type Fake = {
  deps: LoaderDeps;
  batches: string[][];
  listed: string[];
  slept: number[];
};

/** A warehouse whose statement goes through the given states, one per DescribeStatement. */
const fake = ({
  states = [{ status: "FINISHED" }] as StatementState[],
  objects = true,
  rows = 42,
  now = new Date("2026-10-03T12:00:00Z"),
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
        return objects;
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

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("splitStatements", () => {
  it("splits on semicolons that end a line and drops comment-only pieces", () => {
    const sql = [
      "-- header",
      "",
      "CREATE SCHEMA IF NOT EXISTS analytics;",
      "",
      "-- the table",
      "CREATE TABLE t (",
      "  a INT -- not the end; still the table",
      ");",
      "-- trailing comment",
      "",
    ].join("\n");
    expect(splitStatements(sql)).toEqual([
      "-- header\n\nCREATE SCHEMA IF NOT EXISTS analytics",
      "-- the table\nCREATE TABLE t (\n  a INT -- not the end; still the table\n)",
    ]);
  });
});

describe("createHandler: which day", () => {
  it("loads the UTC day before the scheduled time, so a retry loads the same day", async () => {
    const f = fake();
    await createHandler(f.deps)({ scheduledTime: "2026-10-03T06:00:00Z" });
    expect(f.listed).toEqual(["events/dt=2026-10-02/"]);
  });

  it("crosses month and year boundaries", async () => {
    const f = fake();
    await createHandler(f.deps)({ scheduledTime: "2027-01-01T06:00:00Z" });
    expect(f.listed).toEqual(["events/dt=2026-12-31/"]);
  });

  it("loads the given day, for backfills", async () => {
    const f = fake();
    const result = await createHandler(f.deps)({ day: "2026-09-30" });
    expect(f.listed).toEqual(["events/dt=2026-09-30/"]);
    expect(result).toEqual({ day: "2026-09-30", rows: 42 });
  });

  it("loads yesterday when invoked with nothing", async () => {
    const f = fake({ now: new Date("2026-10-03T00:30:00Z") });
    await createHandler(f.deps)({});
    expect(f.listed).toEqual(["events/dt=2026-10-02/"]);
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

describe("loadDay", () => {
  it("applies the DDL, then replaces the day with what the archive holds, in one batch", async () => {
    const f = fake();
    await loadDay("2026-10-02", f.deps);
    expect(f.batches).toEqual([
      [
        ...DDL,
        "DELETE FROM analytics.events WHERE dt = '2026-10-02'",
        "COPY analytics.events FROM 's3://analytics-bucket/events/dt=2026-10-02/' IAM_ROLE default " +
          "FORMAT JSON 'auto' GZIP DATEFORMAT 'auto' TIMEFORMAT 'auto'",
        "SELECT COUNT(*) FROM analytics.events WHERE dt = '2026-10-02'",
      ],
    ]);
  });

  it("skips the COPY for a day with no archive objects, which COPY would reject", async () => {
    const f = fake({ objects: false, rows: 0 });
    const result = await loadDay("2026-10-02", f.deps);
    expect(f.batches[0]).toEqual([
      ...DDL,
      "DELETE FROM analytics.events WHERE dt = '2026-10-02'",
      "SELECT COUNT(*) FROM analytics.events WHERE dt = '2026-10-02'",
    ]);
    expect(result).toEqual({ day: "2026-10-02", rows: 0 });
  });

  it("waits for the batch to finish, backing off between checks", async () => {
    const f = fake({
      states: [{ status: "SUBMITTED" }, { status: "PICKED" }, { status: "STARTED" }, { status: "FINISHED" }],
    });
    const result = await loadDay("2026-10-02", f.deps);
    expect(result.rows).toBe(42);
    expect(f.slept).toEqual([1000, 1500, 2250]);
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('"event":"analytics_load_done"'));
  });

  it.each(["FAILED", "ABORTED"])("throws with Redshift's error when the batch is %s", async (status) => {
    const f = fake({ states: [{ status, error: "S3ServiceException: Access Denied" }] });
    await expect(loadDay("2026-10-02", f.deps)).rejects.toThrow(
      `load of 2026-10-02 ${status}: S3ServiceException: Access Denied`,
    );
  });

  it("gives up once the wait runs out", async () => {
    const f = fake({ states: [{ status: "STARTED" }], maxWaitMs: 5000 });
    await expect(loadDay("2026-10-02", f.deps)).rejects.toThrow(/still running/);
  });
});
