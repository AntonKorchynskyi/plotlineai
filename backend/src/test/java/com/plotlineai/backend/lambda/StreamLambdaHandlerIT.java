package com.plotlineai.backend.lambda;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;

import com.adobe.testing.s3mock.testcontainers.S3MockContainer;
import com.amazonaws.services.lambda.runtime.Context;
import com.plotlineai.backend.AwsTestcontainersConfiguration;
import com.plotlineai.backend.LocalTables;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.GenericContainer;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Drives the real Lambda entry point with Function URL events (payload format 2.0), the way
 * Lambda does, instead of through MockMvc. The handler starts its own Spring context, so the
 * AWS endpoints are handed over as system properties.
 */
class StreamLambdaHandlerIT {

    private static GenericContainer<?> dynamo;
    private static S3MockContainer s3;

    @BeforeAll
    static void startAws() {
        dynamo = new GenericContainer<>("amazon/dynamodb-local:3.3.1")
            .withCommand("-jar", "DynamoDBLocal.jar", "-inMemory", "-sharedDb").withExposedPorts(8000);
        s3 = new S3MockContainer("5.2.3").withInitialBuckets(AwsTestcontainersConfiguration.DATA_BUCKET);
        dynamo.start();
        s3.start();
        String dynamoEndpoint = "http://" + dynamo.getHost() + ":" + dynamo.getMappedPort(8000);
        System.setProperty("aws.accessKeyId", "local");
        System.setProperty("aws.secretAccessKey", "local");
        System.setProperty("plotlineai.aws.dynamodb-endpoint", dynamoEndpoint);
        System.setProperty("plotlineai.aws.s3-endpoint", s3.getHttpEndpoint());
        try (var client = DynamoDbClient.builder().region(Region.US_EAST_1)
                .endpointOverride(URI.create(dynamoEndpoint)).build()) {
            LocalTables.create(client, AwsTestcontainersConfiguration.APP_TABLE);
        }
    }

    @AfterAll
    static void stopAws() {
        s3.stop();
        dynamo.stop();
    }

    private JsonNode invoke(String method, String path, String body) throws Exception {
        String event = """
            {"version":"2.0","routeKey":"$default","rawPath":"%s","rawQueryString":"",
             "headers":{"host":"api.lambda-url.us-east-1.on.aws","content-type":"application/json"},
             "requestContext":{"http":{"method":"%s","path":"%s","protocol":"HTTP/1.1","sourceIp":"10.0.0.1"},
               "requestId":"test","stage":"$default","domainName":"api.lambda-url.us-east-1.on.aws"},
             "body":%s,"isBase64Encoded":false}"""
            .formatted(path, method, path, body == null ? "null" : "\"" + body.replace("\"", "\\\"") + "\"");
        var out = new ByteArrayOutputStream();
        new StreamLambdaHandler().handleRequest(
            new ByteArrayInputStream(event.getBytes(StandardCharsets.UTF_8)), out, mock(Context.class));
        return JsonMapper.builder().build().readTree(out.toString(StandardCharsets.UTF_8));
    }

    @Test
    void servesTheGallery() throws Exception {
        JsonNode response = invoke("GET", "/gallery", null);
        assertEquals(200, response.get("statusCode").asInt());
        assertTrue(response.get("body").asString().startsWith("[{\"slug\":\"revenue-by-region\""));
    }

    @Test
    void consumesFromTheAiBudget() throws Exception {
        JsonNode response = invoke("POST", "/internal/ai-budget/consume", "");
        assertEquals(200, response.get("statusCode").asInt());
        assertEquals("{\"allowed\":true}", response.get("body").asString());
    }
}
