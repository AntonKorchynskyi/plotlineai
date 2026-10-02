package com.plotlineai.backend.share;

import com.plotlineai.backend.aws.AwsProperties;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.core.SdkBytes;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;

/**
 * Shares as DynamoDB items {@code SHARE#<id>}, with no expiry: a share link is permanent. The
 * snapshot is gzipped JSON in a binary attribute, which is what keeps a chart inside the
 * 400 KB item limit.
 */
@Component
public class ShareStore {

    public record StoredShare(UUID id, Instant createdAt, byte[] snapshotGz) {
    }

    private final DynamoDbClient dynamo;
    private final String table;

    public ShareStore(DynamoDbClient dynamo, AwsProperties aws) {
        this.dynamo = dynamo;
        this.table = aws.appTable();
    }

    public void save(UUID id, Instant createdAt, String specJson, byte[] snapshotGz) {
        dynamo.putItem(b -> b.tableName(table).item(Map.of(
            "pk", key(id),
            "createdAt", AttributeValue.fromS(createdAt.toString()),
            "spec", AttributeValue.fromS(specJson),
            "snapshot", AttributeValue.fromB(SdkBytes.fromByteArray(snapshotGz)))));
    }

    public Optional<StoredShare> find(UUID id) {
        Map<String, AttributeValue> item = dynamo.getItem(b -> b.tableName(table).key(Map.of("pk", key(id)))).item();
        if (item == null || item.isEmpty()) return Optional.empty();
        return Optional.of(new StoredShare(id, Instant.parse(item.get("createdAt").s()),
            item.get("snapshot").b().asByteArray()));
    }

    private static AttributeValue key(UUID id) {
        return AttributeValue.fromS("SHARE#" + id);
    }
}
