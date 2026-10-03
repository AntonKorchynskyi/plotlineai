import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";

/**
 * Sends web's usage events to EventBridge (the contract is infra/events/schema.md). Events carry
 * counts and timings only: never an IP, a file name, a column name or a cell value.
 *
 * Publishing is awaited, for at most a second, because a Lambda freezes as soon as it has
 * answered and a background send might never finish. A failure is logged and swallowed:
 * analytics must never cost a user their request. Without EVENT_BUS_NAME (compose, next dev)
 * nothing is sent.
 */

export const EVENT_SOURCE = "plotlineai.web";
export const EVENT_VERSION = 1;
const TIMEOUT_MS = 1000;

type PutEventsAnswer = { FailedEntryCount?: number; Entries?: { ErrorCode?: string }[] };
export type EventSender = (command: PutEventsCommand, signal: AbortSignal) => Promise<PutEventsAnswer>;

let client: EventBridgeClient | undefined;
const sendWithSdk: EventSender = (command, signal) => {
  client ??= new EventBridgeClient({ region: process.env.AWS_REGION || "us-east-1" });
  return client.send(command, { abortSignal: signal });
};

export async function publishEvent(
  detailType: string,
  fields: Record<string, unknown>,
  options: { requestId?: string; send?: EventSender; timeoutMs?: number } = {},
): Promise<void> {
  const bus = process.env.EVENT_BUS_NAME;
  if (!bus) return;

  const detail = {
    version: EVENT_VERSION,
    occurredAt: new Date().toISOString(),
    requestId: options.requestId ?? crypto.randomUUID(),
    ...fields,
  };
  const command = new PutEventsCommand({
    Entries: [
      { EventBusName: bus, Source: EVENT_SOURCE, DetailType: detailType, Detail: JSON.stringify(detail) },
    ],
  });

  try {
    const answer = await (options.send ?? sendWithSdk)(
      command,
      AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
    );
    if (answer.FailedEntryCount) {
      logFailure(detailType, answer.Entries?.[0]?.ErrorCode ?? "FailedEntry");
    }
  } catch (error) {
    logFailure(detailType, error instanceof Error ? error.name : typeof error);
  }
}

function logFailure(detailType: string, error: string) {
  console.warn(JSON.stringify({ event: "event_publish_failed", detailType, error }));
}

/**
 * The Lambda invocation's id, which ties an event to its log lines. Lambda Web Adapter passes
 * the invocation context to the server as the x-amzn-lambda-context header; anything else
 * (compose, a malformed value) gets a fresh id.
 */
export function lambdaRequestId(request: Request): string | undefined {
  const header = request.headers.get("x-amzn-lambda-context");
  if (!header) return undefined;
  try {
    const id: unknown = JSON.parse(header).request_id;
    return typeof id === "string" && /^[\w-]{1,64}$/.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}
