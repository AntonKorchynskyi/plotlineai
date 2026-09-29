package com.plotlineai.backend.aws;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.plotlineai.backend.AwsTestcontainersConfiguration;
import com.plotlineai.backend.TestcontainersConfiguration;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;
import software.amazon.awssdk.services.s3.S3Client;

@SpringBootTest
@Import({TestcontainersConfiguration.class, AwsTestcontainersConfiguration.class})
class AwsClientsIT {

    @Autowired DynamoDbClient dynamo;
    @Autowired S3Client s3;
    @Autowired AwsProperties aws;

    @Test
    void writesAndReadsAnItem() {
        dynamo.putItem(b -> b.tableName(aws.appTable())
            .item(Map.of("pk", AttributeValue.fromS("TEST#1"), "v", AttributeValue.fromS("x"))));
        var item = dynamo.getItem(b -> b.tableName(aws.appTable())
            .key(Map.of("pk", AttributeValue.fromS("TEST#1")))).item();
        assertEquals("x", item.get("v").s());
    }

    @Test
    void writesAndReadsAnObject() {
        s3.putObject(b -> b.bucket(aws.dataBucket()).key("test/a.txt"), RequestBody.fromString("hello"));
        String read = s3.getObjectAsBytes(b -> b.bucket(aws.dataBucket()).key("test/a.txt")).asUtf8String();
        assertEquals("hello", read);
    }
}
