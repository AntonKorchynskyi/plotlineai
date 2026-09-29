package com.plotlineai.backend.dataset;

import com.plotlineai.backend.aws.AwsProperties;
import com.plotlineai.backend.dataset.dto.ColumnSchema;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;
import software.amazon.awssdk.services.s3.S3Client;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/**
 * Parsed datasets. The DynamoDB item {@code DATASET#<id>} is the record that the dataset
 * exists and until when; the data itself is in S3, because an item holds at most 400 KB:
 * <ul>
 *   <li>{@code datasets/<id>/detail.json}: the schema and the first sample rows, all an AI
 *       call or {@code GET /datasets/{id}} needs;</li>
 *   <li>{@code datasets/<id>/rows.json.gz}: every row, read only to render.</li>
 * </ul>
 * TTL removes the item and a lifecycle rule the objects, both some time after expiry, so every
 * read checks {@code expiresAt} itself.
 */
@Component
public class DatasetStore {

    private static final TypeReference<List<List<String>>> ROWS = new TypeReference<>() {};

    /** What {@code detail.json} holds. */
    public record Detail(List<ColumnSchema> schema, List<Map<String, String>> sampleRows) {
    }

    private final DynamoDbClient dynamo;
    private final S3Client s3;
    private final ObjectMapper objectMapper;
    private final String table;
    private final String bucket;

    public DatasetStore(DynamoDbClient dynamo, S3Client s3, ObjectMapper objectMapper, AwsProperties aws) {
        this.dynamo = dynamo;
        this.s3 = s3;
        this.objectMapper = objectMapper;
        this.table = aws.appTable();
        this.bucket = aws.dataBucket();
    }

    /** Writes the objects first, so an item never points at data that is not there. */
    public void save(DatasetRecord record, Detail detail, List<List<String>> rows) {
        s3.putObject(b -> b.bucket(bucket).key(rowsKey(record.id())).contentType("application/json")
            .contentEncoding("gzip"), RequestBody.fromBytes(gzip(objectMapper.writeValueAsBytes(rows))));
        s3.putObject(b -> b.bucket(bucket).key(detailKey(record.id())).contentType("application/json"),
            RequestBody.fromBytes(objectMapper.writeValueAsBytes(detail)));
        dynamo.putItem(b -> b.tableName(table).item(Map.of(
            "pk", key(record.id()),
            "rowCount", AttributeValue.fromN(Integer.toString(record.rowCount())),
            "columnCount", AttributeValue.fromN(Integer.toString(record.columnCount())),
            "bytes", AttributeValue.fromN(Long.toString(record.bytes())),
            "createdAt", AttributeValue.fromS(record.createdAt().toString()),
            "expiresAt", AttributeValue.fromN(Long.toString(record.expiresAt().getEpochSecond())))));
    }

    /** The dataset, unless it does not exist or has passed its expiry. */
    public Optional<DatasetRecord> findLive(UUID id, Instant now) {
        Map<String, AttributeValue> item = dynamo.getItem(b -> b.tableName(table)
            .key(Map.of("pk", key(id))).consistentRead(true)).item();
        if (item == null || item.isEmpty()) return Optional.empty();
        Instant expiresAt = Instant.ofEpochSecond(Long.parseLong(item.get("expiresAt").n()));
        if (!expiresAt.isAfter(now)) return Optional.empty();
        return Optional.of(new DatasetRecord(id,
            Integer.parseInt(item.get("rowCount").n()),
            Integer.parseInt(item.get("columnCount").n()),
            Long.parseLong(item.get("bytes").n()),
            Instant.parse(item.get("createdAt").s()),
            expiresAt));
    }

    public Detail readDetail(UUID id) {
        return objectMapper.readValue(s3.getObjectAsBytes(b -> b.bucket(bucket).key(detailKey(id))).asByteArray(),
            Detail.class);
    }

    public List<List<String>> readRows(UUID id) {
        byte[] gz = s3.getObjectAsBytes(b -> b.bucket(bucket).key(rowsKey(id))).asByteArray();
        try (InputStream in = new GZIPInputStream(new ByteArrayInputStream(gz))) {
            return objectMapper.readValue(in, ROWS);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static AttributeValue key(UUID id) {
        return AttributeValue.fromS("DATASET#" + id);
    }

    private static String rowsKey(UUID id) {
        return "datasets/" + id + "/rows.json.gz";
    }

    private static String detailKey(UUID id) {
        return "datasets/" + id + "/detail.json";
    }

    private static byte[] gzip(byte[] bytes) {
        var out = new ByteArrayOutputStream(bytes.length / 4 + 64);
        try (var gz = new GZIPOutputStream(out)) {
            gz.write(bytes);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return out.toByteArray();
    }
}
