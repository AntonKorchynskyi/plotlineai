package com.plotlineai.backend.insight;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
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
class InsightApiIT {

    private static final String CSV = """
        region,revenue
        north,10.5
        south,20.0
        north,30.0
        east,4.0
        """;

    private static final String UNKNOWN = "00000000-0000-0000-0000-000000000000";

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

    private ResultActions query(String id, String json) throws Exception {
        return mvc.perform(post("/internal/datasets/" + id + "/query")
            .contentType(MediaType.APPLICATION_JSON).content(json));
    }

    private ResultActions storeInsights(String id, String json) throws Exception {
        return mvc.perform(put("/internal/datasets/" + id + "/insights")
            .contentType(MediaType.APPLICATION_JSON).content(json));
    }

    @Test
    void answersAGroupedQuestionOverEveryRow() throws Exception {
        query(datasetId, """
            {"dimension":{"column":"region"},
             "measures":[{"column":"revenue","aggregation":"sum"}],
             "sort":{"by":"measure","direction":"desc"},"limit":2}""")
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.labels[0]").value("north"))
            .andExpect(jsonPath("$.labels[1]").value("south"))
            .andExpect(jsonPath("$.labels.length()").value(2))
            .andExpect(jsonPath("$.series[0].data[0]").value(40.5))
            .andExpect(jsonPath("$.series[0].data.length()").value(2))
            .andExpect(jsonPath("$.totalGroups").value(3))
            // Over every group, the one past the limit (east, 4.0) included.
            .andExpect(jsonPath("$.totals[0]").value(64.5));
    }

    @Test
    void answersAWholeFileQuestionWithoutADimension() throws Exception {
        query(datasetId, """
            {"measures":[{"column":"revenue","aggregation":"sum"},{"column":null,"aggregation":"count"}],
             "filters":[{"column":"region","op":"neq","value":"east"}]}""")
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.labels[0]").value("All rows"))
            .andExpect(jsonPath("$.series[0].data[0]").value(60.5))
            .andExpect(jsonPath("$.series[1].data[0]").value(3.0))
            .andExpect(jsonPath("$.totalGroups").value(1));
    }

    @Test
    void explainsAQueryItCannotRun() throws Exception {
        query(datasetId, """
            {"dimension":{"column":"nope"},"measures":[{"column":"revenue","aggregation":"sum"}]}""")
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("INVALID_CHART_SPEC"))
            .andExpect(jsonPath("$.message").value("The dimension references an unknown column"));
        query(datasetId, """
            {"measures":[{"column":"revenue","aggregation":"sum"}],"sort":{"by":"measure","direction":"desc"}}""")
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.message").value("breakdown and sort need a dimension"));
    }

    @Test
    void anUnknownDatasetIs404() throws Exception {
        query(UNKNOWN, """
            {"measures":[{"column":null,"aggregation":"count"}]}""")
            .andExpect(status().isNotFound());
        storeInsights(UNKNOWN, "{\"insights\":[\"x\"]}").andExpect(status().isNotFound());
        mvc.perform(get("/internal/datasets/" + UNKNOWN + "/insights")).andExpect(status().isNotFound());
    }

    @Test
    void storesInsightsAndReadsThemBack() throws Exception {
        mvc.perform(get("/internal/datasets/" + datasetId + "/insights"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error").value("NOT_FOUND"));

        storeInsights(datasetId, "{\"insights\":[\"North leads with 40.5.\",\"East trails at 4.\"]}")
            .andExpect(status().isNoContent());

        mvc.perform(get("/internal/datasets/" + datasetId + "/insights"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.insights[0]").value("North leads with 40.5."))
            .andExpect(jsonPath("$.insights[1]").value("East trails at 4."));
    }

    @Test
    void refusesAnEmptyOversizedOrOverlongList() throws Exception {
        storeInsights(datasetId, "{\"insights\":[]}")
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("INVALID_REQUEST"));
        storeInsights(datasetId, "{\"insights\":[" + "\"x\",".repeat(10) + "\"x\"]}")
            .andExpect(status().isBadRequest());
        storeInsights(datasetId, "{\"insights\":[\"" + "a".repeat(241) + "\"]}")
            .andExpect(status().isBadRequest());
        storeInsights(datasetId, "{\"insights\":[\"  \"]}")
            .andExpect(status().isBadRequest());
    }

    @Test
    void aShareCarriesTheStoredInsightsPastTheDatasetsExpiry() throws Exception {
        storeInsights(datasetId, "{\"insights\":[\"North leads with 40.5.\"]}").andExpect(status().isNoContent());
        String shareId = shareOf(datasetId);

        dynamo.deleteItem(b -> b.tableName(AwsTestcontainersConfiguration.APP_TABLE)
            .key(Map.of("pk", AttributeValue.fromS("DATASET#" + datasetId))));

        mvc.perform(get("/shares/" + shareId))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.insights[0]").value("North leads with 40.5."))
            .andExpect(jsonPath("$.insights.length()").value(1));
    }

    @Test
    void aShareMadeBeforeTheInsightsAreReadyHasNone() throws Exception {
        mvc.perform(get("/shares/" + shareOf(datasetId)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.insights").isArray())
            .andExpect(jsonPath("$.insights.length()").value(0));
    }

    @Test
    void aShareRequestCannotBringItsOwnInsights() throws Exception {
        mvc.perform(post("/shares").contentType(MediaType.APPLICATION_JSON).content("""
                {"datasetId":"%s","spec":{"chartType":"bar","title":"T","dimension":{"column":"region"},
                 "measures":[{"column":"revenue","aggregation":"sum"}]},"insights":["forged"]}"""
                .formatted(datasetId)))
            .andExpect(status().isBadRequest());
    }

    private String shareOf(String id) throws Exception {
        String body = mvc.perform(post("/shares").contentType(MediaType.APPLICATION_JSON).content("""
                {"datasetId":"%s","spec":{"chartType":"bar","title":"T","dimension":{"column":"region"},
                 "measures":[{"column":"revenue","aggregation":"sum"}]}}""".formatted(id)))
            .andExpect(status().isCreated())
            .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(body).get("shareId").asString();
    }
}
