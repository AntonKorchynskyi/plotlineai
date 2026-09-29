package com.plotlineai.backend.dataset;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.plotlineai.backend.AwsTestcontainersConfiguration;
import com.plotlineai.backend.TestUploads;
import com.plotlineai.backend.TestcontainersConfiguration;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;
import software.amazon.awssdk.services.s3.S3Client;
import tools.jackson.databind.ObjectMapper;

/**
 * DynamoDB's TTL can remove an expired item up to about two days late, so a dataset past its
 * expiry has to look gone to every read whether or not the item is still there.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Import({TestcontainersConfiguration.class, AwsTestcontainersConfiguration.class})
class DatasetExpiryIT {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired S3Client s3;
    @Autowired DynamoDbClient dynamo;

    private TestUploads uploads;

    @BeforeEach
    void setUp() {
        uploads = new TestUploads(mvc, s3, objectMapper);
    }

    private UUID upload() throws Exception {
        return uploads.datasetId("data.csv",
            "region,revenue\nnorth,10\nsouth,20\n".getBytes(StandardCharsets.UTF_8));
    }

    private void expire(UUID id) {
        dynamo.updateItem(b -> b.tableName(AwsTestcontainersConfiguration.APP_TABLE)
            .key(Map.of("pk", AttributeValue.fromS("DATASET#" + id)))
            .updateExpression("SET expiresAt = :past")
            .expressionAttributeValues(Map.of(":past",
                AttributeValue.fromN(Long.toString(Instant.now().minusSeconds(60).getEpochSecond())))));
    }

    private String renderBody(UUID id) {
        return """
            {"datasetId":"%s","spec":{"chartType":"bar","title":"Revenue",
             "dimension":{"column":"region"},"measures":[{"column":"revenue","aggregation":"sum"}]}}"""
            .formatted(id);
    }

    @Test
    void anExpiredDatasetIsNotFound() throws Exception {
        UUID id = upload();
        expire(id);

        mvc.perform(get("/datasets/" + id))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error").value("NOT_FOUND"));
    }

    @Test
    void anExpiredDatasetCannotBeRendered() throws Exception {
        UUID id = upload();
        expire(id);

        mvc.perform(post("/charts/render").contentType(MediaType.APPLICATION_JSON).content(renderBody(id)))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error").value("NOT_FOUND"));
    }

    @Test
    void aLiveDatasetIsStillServed() throws Exception {
        UUID id = upload();

        mvc.perform(get("/datasets/" + id)).andExpect(status().isOk());
        mvc.perform(post("/charts/render").contentType(MediaType.APPLICATION_JSON).content(renderBody(id)))
            .andExpect(status().isOk());
    }
}
