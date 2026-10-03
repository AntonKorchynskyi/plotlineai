package com.plotlineai.backend.events;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.plotlineai.backend.AwsTestcontainersConfiguration;
import com.plotlineai.backend.TestUploads;
import com.plotlineai.backend.aibudget.AiBudgetService;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import software.amazon.awssdk.services.s3.S3Client;
import tools.jackson.databind.ObjectMapper;

/** Which requests publish which event, with which fields (infra/events/schema.md). */
@SpringBootTest(properties = {"plotlineai.ai.daily-call-limit=1", "plotlineai.dataset.upload-daily-limit=1000"})
@AutoConfigureMockMvc
@Import(AwsTestcontainersConfiguration.class)
class EventsApiIT {

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
    @Autowired AiBudgetService aiBudget;
    @MockitoBean EventPublisher events;

    private UUID datasetId;

    @BeforeEach
    void uploadDataset() throws Exception {
        datasetId = new TestUploads(mvc, s3, objectMapper)
            .datasetId("data.csv", CSV.getBytes(StandardCharsets.UTF_8));
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> fieldsOf(String detailType) {
        ArgumentCaptor<Map<String, Object>> fields = ArgumentCaptor.forClass(Map.class);
        verify(events).publish(eq(detailType), fields.capture());
        return fields.getValue();
    }

    private ResultActions send(String path, String json) throws Exception {
        return mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).content(json));
    }

    @Test
    void anUploadPublishesItsShapeButNothingFromTheFile() {
        Map<String, Object> fields = fieldsOf("dataset.uploaded");
        assertEquals(3, fields.get("rowCount"));
        assertEquals(2, fields.get("columnCount"));
        assertEquals((long) CSV.getBytes(StandardCharsets.UTF_8).length, fields.get("bytes"));
        assertTrue((Long) fields.get("parseMs") >= 0);
        assertEquals(4, fields.size());
    }

    @Test
    void aRenderPublishesChartRendered() throws Exception {
        send("/charts/render", "{\"datasetId\":\"" + datasetId + "\",\"spec\":" + SPEC + "}")
            .andExpect(status().isOk());

        Map<String, Object> fields = fieldsOf("chart.rendered");
        assertEquals("bar", fields.get("chartType"));
        assertEquals(2, fields.get("groups"));
        assertEquals(1, fields.get("seriesCount"));
        assertTrue((Long) fields.get("ms") >= 0);
    }

    @Test
    void aShareIsNotAlsoCountedAsARender() throws Exception {
        send("/shares", "{\"datasetId\":\"" + datasetId + "\",\"spec\":" + SPEC + "}")
            .andExpect(status().isCreated());

        Map<String, Object> fields = fieldsOf("share.created");
        assertEquals("bar", fields.get("chartType"));
        assertTrue((Integer) fields.get("snapshotBytes") > 0);
        verify(events, never()).publish(eq("chart.rendered"), anyMap());
    }

    @Test
    void aRejectedRenderPublishesNothing() throws Exception {
        clearInvocations(events);
        send("/charts/render", "{\"datasetId\":\"" + UUID.randomUUID() + "\",\"spec\":" + SPEC + "}")
            .andExpect(status().isNotFound());

        verify(events, never()).publish(eq("chart.rendered"), anyMap());
    }

    @Test
    void theAiQuotaRunningOutIsPublishedOncePerDay() {
        LocalDate day = LocalDate.of(2102, 1, 1);
        aiBudget.consume(day);
        aiBudget.consume(day);
        aiBudget.consume(day);

        verify(events, times(1)).publish(eq("quota.exhausted"), eq(Map.of(
            "quota", "ai", "limit", 1, "day", "2102-01-01")));
    }
}
