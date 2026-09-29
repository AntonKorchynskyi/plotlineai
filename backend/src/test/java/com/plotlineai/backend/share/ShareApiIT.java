package com.plotlineai.backend.share;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.plotlineai.backend.AwsTestcontainersConfiguration;
import com.plotlineai.backend.TestUploads;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;
import software.amazon.awssdk.services.s3.S3Client;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest
@AutoConfigureMockMvc
@Import(AwsTestcontainersConfiguration.class)
class ShareApiIT {

    private static final String CSV = """
        region,revenue
        north,10.5
        south,20.0
        north,30.0
        """;

    private static final String SPEC = """
        {"chartType":"bar","title":"Revenue by region",
         "dimension":{"column":"region"},
         "measures":[{"column":"revenue","aggregation":"sum"}]}""";

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired S3Client s3;
    @Autowired DynamoDbClient dynamo;

    private String datasetId;

    @BeforeEach
    void uploadDataset() throws Exception {
        datasetId = new TestUploads(mvc, s3, objectMapper)
            .datasetId("data.csv", CSV.getBytes(StandardCharsets.UTF_8)).toString();
    }

    private long storedShares() {
        return dynamo.scan(b -> b.tableName(AwsTestcontainersConfiguration.APP_TABLE)
                .filterExpression("begins_with(pk, :share)")
                .expressionAttributeValues(Map.of(":share", AttributeValue.fromS("SHARE#"))))
            .count();
    }

    private ResultActions createShare(String json) throws Exception {
        return mvc.perform(post("/shares").contentType(MediaType.APPLICATION_JSON).content(json));
    }

    private String shareIdFor(String id) throws Exception {
        String body = createShare("{\"datasetId\":\"" + id + "\",\"spec\":" + SPEC + "}")
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.shareId").isNotEmpty())
            .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(body).get("shareId").asString();
    }

    @Test
    void createsAShareAndReadsBackTheServerRenderedSnapshot() throws Exception {
        String shareId = shareIdFor(datasetId);

        mvc.perform(get("/shares/" + shareId))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.shareId").value(shareId))
            .andExpect(jsonPath("$.createdAt").isNotEmpty())
            .andExpect(jsonPath("$.renderedData.chartType").value("bar"))
            .andExpect(jsonPath("$.renderedData.title").value("Revenue by region"))
            .andExpect(jsonPath("$.renderedData.labels[0]").value("north"))
            .andExpect(jsonPath("$.renderedData.labels[1]").value("south"))
            .andExpect(jsonPath("$.renderedData.datasets[0].data[0]").value(40.5))
            .andExpect(jsonPath("$.renderedData.datasets[0].data[1]").value(20.0));
    }

    @Test
    void shareSurvivesDeletionOfTheUnderlyingDataset() throws Exception {
        String shareId = shareIdFor(datasetId);

        // Simulates TTL expiry: the snapshot is stored, so the share must not need the dataset.
        dynamo.deleteItem(b -> b.tableName(AwsTestcontainersConfiguration.APP_TABLE)
            .key(Map.of("pk", AttributeValue.fromS("DATASET#" + datasetId))));
        mvc.perform(get("/datasets/" + datasetId)).andExpect(status().isNotFound());

        mvc.perform(get("/shares/" + shareId))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.renderedData.labels[0]").value("north"))
            .andExpect(jsonPath("$.renderedData.datasets[0].data[0]").value(40.5));
    }

    @Test
    void responseDoesNotExposeTheSpec() throws Exception {
        String shareId = shareIdFor(datasetId);
        mvc.perform(get("/shares/" + shareId))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.spec").doesNotExist());
    }

    @Test
    void unknownShareIs404() throws Exception {
        mvc.perform(get("/shares/00000000-0000-0000-0000-000000000000"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error").value("NOT_FOUND"));
    }

    @Test
    void malformedShareIdIs404() throws Exception {
        mvc.perform(get("/shares/not-a-uuid"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error").value("NOT_FOUND"))
            .andExpect(jsonPath("$.message").value("Resource not found"));
    }

    @Test
    void missingDatasetIs404() throws Exception {
        createShare("{\"datasetId\":\"00000000-0000-0000-0000-000000000000\",\"spec\":" + SPEC + "}")
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error").value("NOT_FOUND"));
    }

    @Test
    void unknownColumnIs400() throws Exception {
        createShare("{\"datasetId\":\"" + datasetId + "\",\"spec\":"
            + "{\"chartType\":\"bar\",\"title\":\"T\",\"dimension\":{\"column\":\"nope\"},"
            + "\"measures\":[{\"column\":\"revenue\",\"aggregation\":\"sum\"}]}}")
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("INVALID_CHART_SPEC"));
    }

    @Test
    void missingDatasetIdIs400() throws Exception {
        createShare("{\"spec\":" + SPEC + "}")
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("INVALID_CHART_SPEC"));
    }

    @Test
    void oversizedFilterValueIsRejectedAndNothingStored() throws Exception {
        String longValue = "a".repeat(257);
        String specWithFilter = "{\"chartType\":\"bar\",\"title\":\"T\","
            + "\"dimension\":{\"column\":\"region\"},"
            + "\"measures\":[{\"column\":\"revenue\",\"aggregation\":\"sum\"}],"
            + "\"filters\":[{\"column\":\"region\",\"op\":\"neq\",\"value\":\"" + longValue + "\"}]}";

        long before = storedShares();
        createShare("{\"datasetId\":\"" + datasetId + "\",\"spec\":" + specWithFilter + "}")
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("INVALID_CHART_SPEC"));
        assertEquals(before, storedShares());
    }

    @Test
    void clientSuppliedRenderedDataIsRejected() throws Exception {
        // The old contract shape must not be accepted: nothing client-rendered is persisted.
        createShare("{\"datasetId\":\"" + datasetId + "\",\"spec\":" + SPEC
            + ",\"renderedData\":{\"labels\":[\"forged\"],\"datasets\":[]}}")
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("INVALID_CHART_SPEC"));
    }
}
