import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";

/**
 * Archives usage events (infra/events/schema.md) for analytics. EventBridge sends every event on
 * the bus to an SQS queue, and this function drains it in batches: each batch becomes one
 * gzipped JSON Lines object per event date, `events/dt=YYYY-MM-DD/<uuid>.json.gz`, which the
 * redshift-loader copies into Redshift a day at a time. Row keys are the Redshift column names.
 *
 * A message that is not a PlotlineAI event, and every message of a date whose object could not
 * be written, is reported back as a batch item failure: SQS retries it, then moves it to the DLQ.
 */

export type ArchiveRow = {
  dt: string;
  occurred_at: string;
  detail_type: string;
  source: string;
  request_id: string;
  detail: Record<string, unknown>;
};

export type PutObject = (key: string, body: Uint8Array) => Promise<void>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** One SQS message body (an EventBridge event) as an archive row; throws if it is not one of ours. */
export function toRow(body: string): ArchiveRow {
  const event: unknown = JSON.parse(body);
  if (!isObject(event)) throw new Error("not an object");
  const { source, "detail-type": detailType, detail } = event;
  if (typeof source !== "string" || !source.startsWith("plotlineai.")) throw new Error("unknown source");
  if (typeof detailType !== "string" || !detailType) throw new Error("no detail-type");
  if (!isObject(detail)) throw new Error("no detail");

  const { occurredAt, requestId } = detail;
  const occurred = typeof occurredAt === "string" ? new Date(occurredAt) : new Date(Number.NaN);
  if (Number.isNaN(occurred.getTime())) throw new Error("no occurredAt");

  const iso = occurred.toISOString();
  return {
    dt: iso.slice(0, 10),
    occurred_at: iso,
    detail_type: detailType,
    source,
    request_id: typeof requestId === "string" ? requestId : "",
    detail,
  };
}

export function createHandler(put: PutObject) {
  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const failed: string[] = [];
    const byDate = new Map<string, { rows: ArchiveRow[]; messages: SQSRecord[] }>();

    for (const record of event.Records) {
      let row: ArchiveRow;
      try {
        row = toRow(record.body);
      } catch (error) {
        console.warn(
          JSON.stringify({
            event: "archive_message_rejected",
            messageId: record.messageId,
            reason: error instanceof Error ? error.message : "unparseable",
          }),
        );
        failed.push(record.messageId);
        continue;
      }
      const group = byDate.get(row.dt) ?? { rows: [], messages: [] };
      group.rows.push(row);
      group.messages.push(record);
      byDate.set(row.dt, group);
    }

    for (const [dt, { rows, messages }] of byDate) {
      const key = `events/dt=${dt}/${randomUUID()}.json.gz`;
      const lines = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
      try {
        await put(key, gzipSync(lines));
        console.info(JSON.stringify({ event: "archive_written", key, rows: rows.length }));
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "archive_write_failed",
            dt,
            error: error instanceof Error ? error.name : typeof error,
          }),
        );
        failed.push(...messages.map((m) => m.messageId));
      }
    }

    return { batchItemFailures: failed.map((itemIdentifier) => ({ itemIdentifier })) };
  };
}

let s3: S3Client | undefined;
const putToS3: PutObject = async (key, body) => {
  s3 ??= new S3Client({});
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.ANALYTICS_BUCKET,
      Key: key,
      Body: body,
      ContentType: "application/gzip",
    }),
  );
};

export const handler = createHandler(putToS3);
