package com.plotlineai.backend.quota;

import com.plotlineai.backend.aws.AwsProperties;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Map;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;
import software.amazon.awssdk.services.dynamodb.model.ConditionalCheckFailedException;

/**
 * A per-UTC-day allowance kept in DynamoDB, one item per name and day. The count lives in the
 * table rather than in memory, so no restart or new Lambda instance hands out a fresh allowance,
 * and TTL removes each day's item two days later.
 */
@Component
public class DailyCounter {

    private final DynamoDbClient dynamo;
    private final String table;

    public DailyCounter(DynamoDbClient dynamo, AwsProperties aws) {
        this.dynamo = dynamo;
        this.table = aws.appTable();
    }

    /**
     * Takes one from the day's allowance; false when it is already spent. One conditional
     * write, so concurrent callers can never push the count past the limit: the increment only
     * happens while there is room.
     */
    public boolean tryConsume(String name, LocalDate day, int limit) {
        long expiresAt = day.plusDays(2).atStartOfDay(ZoneOffset.UTC).toEpochSecond();
        try {
            dynamo.updateItem(b -> b.tableName(table)
                .key(Map.of("pk", AttributeValue.fromS("QUOTA#" + name + "#" + day)))
                .updateExpression("ADD calls :one SET expiresAt = :expiresAt")
                .conditionExpression("attribute_not_exists(calls) OR calls < :limit")
                .expressionAttributeValues(Map.of(
                    ":one", AttributeValue.fromN("1"),
                    ":expiresAt", AttributeValue.fromN(Long.toString(expiresAt)),
                    ":limit", AttributeValue.fromN(Integer.toString(limit)))));
            return true;
        } catch (ConditionalCheckFailedException spent) {
            return false;
        }
    }
}
