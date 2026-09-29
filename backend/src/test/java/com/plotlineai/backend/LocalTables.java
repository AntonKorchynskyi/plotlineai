package com.plotlineai.backend;

import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeDefinition;
import software.amazon.awssdk.services.dynamodb.model.BillingMode;
import software.amazon.awssdk.services.dynamodb.model.KeySchemaElement;
import software.amazon.awssdk.services.dynamodb.model.KeyType;
import software.amazon.awssdk.services.dynamodb.model.ResourceInUseException;
import software.amazon.awssdk.services.dynamodb.model.ScalarAttributeType;

/** Mirrors the CDK key schema (infra/lib/data-stack.ts): a string partition key "pk", nothing else. */
public final class LocalTables {

    public static void create(DynamoDbClient dynamo, String tableName) {
        try {
            dynamo.createTable(b -> b.tableName(tableName)
                .billingMode(BillingMode.PAY_PER_REQUEST)
                .attributeDefinitions(AttributeDefinition.builder()
                    .attributeName("pk").attributeType(ScalarAttributeType.S).build())
                .keySchema(KeySchemaElement.builder().attributeName("pk").keyType(KeyType.HASH).build()));
        } catch (ResourceInUseException alreadyThere) {
            // Contexts share the containers, so a later context finds the table in place.
        }
    }

    private LocalTables() {
    }
}
