import {
  BatchExecuteStatementCommand,
  DescribeStatementCommand,
  GetStatementResultCommand,
  RedshiftDataClient,
} from "@aws-sdk/client-redshift-data";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import schemaSql from "../../analytics/01-schema.sql";
import viewsSql from "../../analytics/02-views.sql";

/**
 * Loads one UTC day of the usage event archive (infra/events/schema.md) into Redshift
 * Serverless. EventBridge Scheduler invokes it every morning with its scheduled time, and it
 * loads the day before that time; `{ "day": "YYYY-MM-DD" }` loads any day by hand.
 *
 * One Data API batch, which Redshift runs as a single transaction: the DDL in
 * infra/analytics/*.sql (idempotent), then the day's rows are deleted and copied back in from
 * `events/dt=<day>/`. Running a day again gives the same result. A failed or unfinished load
 * throws, which the loader-errors alarm emails to the owner.
 */

export type LoaderEvent = { day?: string; scheduledTime?: string };

export type StatementState = { status: string; error?: string };

/** The Data API calls the loader makes, behind a seam for tests. */
export type Warehouse = {
  /** Starts the statements as one transaction and returns the batch's id. */
  run: (sqls: string[]) => Promise<string>;
  describe: (id: string) => Promise<StatementState>;
  /** The single number a finished `SELECT COUNT(*)` sub-statement returned. */
  count: (subStatementId: string) => Promise<number>;
};

export type LoaderDeps = {
  /** The DDL statements, in order. */
  statements: string[];
  bucket: string;
  warehouse: Warehouse;
  hasObjects: (prefix: string) => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  /** How long to wait for the batch before giving up. */
  maxWaitMs: number;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The statements in a SQL file: each one ends with a semicolon at the end of a line. */
export function splitStatements(sql: string): string[] {
  return sql
    .split(/;[ \t]*\r?$/m)
    .map((piece) => piece.trim())
    .filter((piece) => piece.split("\n").some((line) => line.trim() && !line.trim().startsWith("--")));
}

/** The UTC day before `time`, as YYYY-MM-DD. */
const dayBefore = (time: Date) => new Date(time.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10);

/**
 * The day to load. It ends up inside the SQL (the Data API takes no parameters in a batch), so
 * anything but a real calendar date is refused.
 */
function resolveDay(event: LoaderEvent, now: Date): string {
  if (event.day !== undefined) {
    const day = event.day;
    const parsed = new Date(`${day}T00:00:00Z`);
    if (!DAY.test(day) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) {
      throw new Error(`not a day: ${JSON.stringify(day)} (expected YYYY-MM-DD)`);
    }
    return day;
  }
  if (event.scheduledTime !== undefined) {
    const time = new Date(event.scheduledTime);
    if (Number.isNaN(time.getTime())) throw new Error(`not a scheduledTime: ${JSON.stringify(event.scheduledTime)}`);
    return dayBefore(time);
  }
  return dayBefore(now);
}

export async function loadDay(day: string, deps: LoaderDeps): Promise<{ day: string; rows: number }> {
  const started = deps.now().getTime();
  const prefix = `events/dt=${day}/`;
  const copy = await deps.hasObjects(prefix);
  const sqls = [
    ...deps.statements,
    `DELETE FROM analytics.events WHERE dt = '${day}'`,
    ...(copy
      ? [
          `COPY analytics.events FROM 's3://${deps.bucket}/${prefix}' IAM_ROLE default ` +
            "FORMAT JSON 'auto' GZIP DATEFORMAT 'auto' TIMEFORMAT 'auto'",
        ]
      : []),
    `SELECT COUNT(*) FROM analytics.events WHERE dt = '${day}'`,
  ];

  const id = await deps.warehouse.run(sqls);
  let wait = 1000;
  for (;;) {
    const state = await deps.warehouse.describe(id);
    if (state.status === "FINISHED") break;
    if (state.status === "FAILED" || state.status === "ABORTED") {
      throw new Error(`load of ${day} ${state.status}: ${state.error ?? "no error given"}`);
    }
    if (deps.now().getTime() - started + wait > deps.maxWaitMs) {
      throw new Error(`load of ${day} still running after ${deps.maxWaitMs} ms (statement ${id})`);
    }
    await deps.sleep(wait);
    wait = Math.min(wait * 1.5, 10_000);
  }

  // Sub-statements are numbered from 1; the count is the last one.
  const rows = await deps.warehouse.count(`${id}:${sqls.length}`);
  console.info(
    JSON.stringify({
      event: "analytics_load_done",
      day,
      rows,
      copied: copy,
      ms: deps.now().getTime() - started,
      statementId: id,
    }),
  );
  return { day, rows };
}

export function createHandler(deps: LoaderDeps) {
  return async (event: LoaderEvent = {}) => loadDay(resolveDay(event ?? {}, deps.now()), deps);
}

let redshift: RedshiftDataClient | undefined;
let s3: S3Client | undefined;

const warehouse: Warehouse = {
  run: async (sqls) => {
    redshift ??= new RedshiftDataClient({});
    const { Id } = await redshift.send(
      new BatchExecuteStatementCommand({
        WorkgroupName: process.env.WORKGROUP_NAME,
        Database: process.env.DATABASE_NAME,
        SecretArn: process.env.ADMIN_SECRET_ARN,
        Sqls: sqls,
        StatementName: "plotlineai-load",
      }),
    );
    if (!Id) throw new Error("the Data API returned no statement id");
    return Id;
  },
  describe: async (id) => {
    redshift ??= new RedshiftDataClient({});
    const { Status, Error: error } = await redshift.send(new DescribeStatementCommand({ Id: id }));
    return { status: Status ?? "UNKNOWN", error };
  },
  count: async (id) => {
    redshift ??= new RedshiftDataClient({});
    const { Records } = await redshift.send(new GetStatementResultCommand({ Id: id }));
    return Number(Records?.[0]?.[0]?.longValue ?? 0);
  },
};

export const handler = createHandler({
  statements: [...splitStatements(schemaSql), ...splitStatements(viewsSql)],
  bucket: process.env.ANALYTICS_BUCKET ?? "",
  warehouse,
  hasObjects: async (prefix) => {
    s3 ??= new S3Client({});
    const { KeyCount } = await s3.send(
      new ListObjectsV2Command({ Bucket: process.env.ANALYTICS_BUCKET, Prefix: prefix, MaxKeys: 1 }),
    );
    return (KeyCount ?? 0) > 0;
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => new Date(),
  // The function's timeout is 5 minutes; leave room to report.
  maxWaitMs: 270_000,
});
