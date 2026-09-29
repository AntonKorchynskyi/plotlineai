import { ConditionalCheckFailedException, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { describe, expect, it, vi } from "vitest";
import { createDynamoStore } from "@/lib/rate-limit-store";

describe("createDynamoStore", () => {
  const client = (send: (command: UpdateItemCommand) => Promise<unknown>) =>
    ({ send: vi.fn(send) }) as unknown as import("@aws-sdk/client-dynamodb").DynamoDBClient;

  it("increments with one conditional write that sets the item's expiry", async () => {
    const dynamo = client(async () => ({}));
    const store = createDynamoStore("plotlineai-rate-limits", dynamo);

    expect(await store.increment("t#g#1800000000", 30, 1800000120)).toBe(true);

    const command = (dynamo.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as UpdateItemCommand;
    expect(command.input).toEqual({
      TableName: "plotlineai-rate-limits",
      Key: { pk: { S: "t#g#1800000000" } },
      UpdateExpression: "ADD calls :one SET expiresAt = :expiresAt",
      ConditionExpression: "attribute_not_exists(calls) OR calls < :limit",
      ExpressionAttributeValues: {
        ":one": { N: "1" },
        ":expiresAt": { N: "1800000120" },
        ":limit": { N: "30" },
      },
    });
  });

  it("answers false when the condition fails: the window's allowance is spent", async () => {
    const store = createDynamoStore(
      "t",
      client(async () => {
        throw new ConditionalCheckFailedException({ message: "spent", $metadata: {} });
      }),
    );
    expect(await store.increment("k", 1, 1)).toBe(false);
  });

  it("lets any other failure through to the limiter, which fails open", async () => {
    const store = createDynamoStore(
      "t",
      client(async () => {
        throw new Error("network");
      }),
    );
    await expect(store.increment("k", 1, 1)).rejects.toThrow("network");
  });
});
