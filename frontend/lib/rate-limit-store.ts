import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";

/**
 * Where the rate limiter keeps its counters. A counter only ever goes up by one, and only while
 * it is below its limit; it disappears once its window is over.
 */
export interface CounterStore {
  /**
   * Adds one to `key` if it is below `limit`, and answers whether it did. `expiresAt` (epoch
   * seconds) is when the counter may be forgotten.
   */
  increment(key: string, limit: number, expiresAt: number): Promise<boolean>;
}

/**
 * The shared store: one DynamoDB item per counter, updated with a single conditional write, so
 * any number of web instances agree on the count and none can push it past the limit. TTL on
 * `expiresAt` clears old windows.
 */
export function createDynamoStore(table: string, client = createDynamoClient()): CounterStore {
  return {
    async increment(key, limit, expiresAt) {
      try {
        await client.send(
          new UpdateItemCommand({
            TableName: table,
            Key: { pk: { S: key } },
            UpdateExpression: "ADD calls :one SET expiresAt = :expiresAt",
            ConditionExpression: "attribute_not_exists(calls) OR calls < :limit",
            ExpressionAttributeValues: {
              ":one": { N: "1" },
              ":expiresAt": { N: String(expiresAt) },
              ":limit": { N: String(limit) },
            },
          }),
        );
        return true;
      } catch (error) {
        if (error instanceof ConditionalCheckFailedException) return false;
        throw error;
      }
    },
  };
}

/** DYNAMODB_ENDPOINT points compose at DynamoDB Local; unset, the SDK uses the real service. */
function createDynamoClient() {
  return new DynamoDBClient({
    region: process.env.AWS_REGION || "us-east-1",
    ...(process.env.DYNAMODB_ENDPOINT ? { endpoint: process.env.DYNAMODB_ENDPOINT } : {}),
  });
}

/**
 * Counters in this process's memory: correct only for a single instance. Used by `next dev`
 * without a table, and by tests. Expired counters are dropped once the map grows, and if a
 * flood of distinct keys keeps it large anyway, it starts over rather than grow without bound.
 */
export function createMemoryStore(now: () => number = Date.now, maxKeys = 10_000): CounterStore {
  const counters = new Map<string, { count: number; expiresAt: number }>();

  const sweep = (at: number) => {
    for (const [key, counter] of counters) {
      if (counter.expiresAt * 1000 <= at) counters.delete(key);
    }
    if (counters.size > maxKeys) counters.clear();
  };

  return {
    async increment(key, limit, expiresAt) {
      const at = now();
      let counter = counters.get(key);
      if (!counter || counter.expiresAt * 1000 <= at) {
        counter = { count: 0, expiresAt };
        counters.set(key, counter);
        if (counters.size > maxKeys) sweep(at);
      }
      if (counter.count >= limit) return false;
      counter.count += 1;
      return true;
    },
  };
}

let shared: CounterStore | undefined;

/** The DynamoDB store when RATE_LIMIT_TABLE names a table, otherwise one in memory. */
export function defaultStore(): CounterStore {
  shared ??= process.env.RATE_LIMIT_TABLE
    ? createDynamoStore(process.env.RATE_LIMIT_TABLE)
    : createMemoryStore();
  return shared;
}
