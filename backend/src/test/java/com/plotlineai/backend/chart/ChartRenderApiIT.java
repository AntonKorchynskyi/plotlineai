package com.plotlineai.backend.chart;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.plotlineai.backend.AwsTestcontainersConfiguration;
import com.plotlineai.backend.TestUploads;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import software.amazon.awssdk.services.s3.S3Client;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest
@AutoConfigureMockMvc
@Import(AwsTestcontainersConfiguration.class)
class ChartRenderApiIT {

    private static final String CSV = """
        region,joined,revenue,units
        north,2024-01-15,10.5,1
        south,2024-01-20,20.0,2
        north,2024-02-10,30.0,3
        south,2024-04-01,5.5,4
        """;

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private S3Client s3;

    private String datasetId;

    @BeforeEach
    void uploadDataset() throws Exception {
        datasetId = new TestUploads(mockMvc, s3, objectMapper)
            .datasetId("data.csv", CSV.getBytes(StandardCharsets.UTF_8)).toString();
    }

    private org.springframework.test.web.servlet.ResultActions renderRaw(String json)
            throws Exception {
        return mockMvc.perform(post("/charts/render")
            .contentType(MediaType.APPLICATION_JSON)
            .content(json));
    }

    private org.springframework.test.web.servlet.ResultActions render(String specJson)
            throws Exception {
        return renderRaw("{\"datasetId\":\"" + datasetId + "\",\"spec\":" + specJson + "}");
    }

    private org.springframework.test.web.servlet.ResultActions validate(String body) throws Exception {
        return mockMvc.perform(post("/charts/validate")
            .contentType(MediaType.APPLICATION_JSON)
            .content(body));
    }

    @Test
    void validatesEachSpecAgainstTheSchemaInOrder() throws Exception {
        validate("{\"datasetId\":\"" + datasetId + "\",\"specs\":["
            + """
            {"chartType":"bar","title":"Ok","dimension":{"column":"region"},
             "measures":[{"column":"revenue","aggregation":"sum"}]},
            {"chartType":"bar","title":"Sum of text","dimension":{"column":"joined"},
             "measures":[{"column":"region","aggregation":"sum"}]}]}""")
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.results.length()").value(2))
            .andExpect(jsonPath("$.results[0].error").doesNotExist())
            .andExpect(jsonPath("$.results[1].error").value("This aggregation requires a numeric column"));
    }

    @Test
    void validateRefusesASpecThatWouldDrawNothing() throws Exception {
        validate("{\"datasetId\":\"" + datasetId + "\",\"specs\":["
            + """
            {"chartType":"bar","title":"Nowhere","dimension":{"column":"region"},
             "measures":[{"column":"revenue","aggregation":"sum"}],
             "filters":[{"column":"region","op":"eq","value":"atlantis"}]}]}""")
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.results[0].error").value(ChartService.NO_DATA));
    }

    @Test
    void validateTakesAtMostThreeSpecs() throws Exception {
        String spec = """
            {"chartType":"bar","title":"Ok","dimension":{"column":"region"},
             "measures":[{"column":"revenue","aggregation":"sum"}]}""";
        validate("{\"datasetId\":\"" + datasetId + "\",\"specs\":[" + String.join(",", spec, spec, spec, spec) + "]}")
            .andExpect(status().isBadRequest());
        validate("{\"datasetId\":\"" + datasetId + "\",\"specs\":[]}")
            .andExpect(status().isBadRequest());
    }

    @Test
    void validateOnAnUnknownDatasetIs404() throws Exception {
        validate("""
            {"datasetId":"0b0c6f7e-3f1e-4d2b-9c1a-111111111111","specs":[
             {"chartType":"bar","title":"Ok","dimension":{"column":"region"},
              "measures":[{"column":"revenue","aggregation":"sum"}]}]}""")
            .andExpect(status().isNotFound());
    }

    @Test
    void rendersBarSumByRegion() throws Exception {
        render("""
            {"chartType":"bar","title":"Revenue by region","dimension":{"column":"region"},
             "measures":[{"column":"revenue","aggregation":"sum"}]}""")
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.chartType").value("bar"))
            .andExpect(jsonPath("$.stacked").value(false))
            .andExpect(jsonPath("$.title").value("Revenue by region"))
            .andExpect(jsonPath("$.labels[0]").value("north"))
            .andExpect(jsonPath("$.labels[1]").value("south"))
            .andExpect(jsonPath("$.datasets[0].label").value("sum(revenue)"))
            .andExpect(jsonPath("$.datasets[0].data[0]").value(40.5))
            .andExpect(jsonPath("$.datasets[0].data[1]").value(25.5));
    }

    @Test
    void rendersMonthBucketLine() throws Exception {
        render("""
            {"chartType":"line","title":"Monthly","dimension":{"column":"joined","bucket":"month"},
             "measures":[{"column":null,"aggregation":"count"}]}""")
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.labels[0]").value("2024-01"))
            .andExpect(jsonPath("$.datasets[0].data[0]").value(2.0));
    }

    @Test
    void rendersScatterPoints() throws Exception {
        render("""
            {"chartType":"scatter","title":"S","dimension":{"column":"region"},
             "measures":[{"column":"units","aggregation":"none"},
                         {"column":"revenue","aggregation":"none"}]}""")
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.datasets[0].data[0].x").value(1.0))
            .andExpect(jsonPath("$.datasets[0].data[0].y").value(10.5));
    }

    @Test
    void unknownColumnIs400InvalidChartSpec() throws Exception {
        render("""
            {"chartType":"bar","title":"T","dimension":{"column":"nope"},
             "measures":[{"column":"revenue","aggregation":"sum"}]}""")
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("INVALID_CHART_SPEC"));
    }

    @Test
    void unknownJsonPropertyIs400() throws Exception {
        render("""
            {"chartType":"bar","title":"T","evil":true,"dimension":{"column":"region"},
             "measures":[{"column":"revenue","aggregation":"sum"}]}""")
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("INVALID_CHART_SPEC"));
    }

    @Test
    void beanValidationFailureIs400() throws Exception {
        render("""
            {"chartType":"bar","title":"T","dimension":{"column":"region"},
             "measures":[]}""")
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("INVALID_CHART_SPEC"));
    }

    @Test
    void nullMeasureElementIs400InvalidChartSpec() throws Exception {
        render("""
            {"chartType":"bar","title":"T","dimension":{"column":"region"},
             "measures":[null]}""")
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("INVALID_CHART_SPEC"));
    }

    @Test
    void unknownEnumValueIs400() throws Exception {
        render("""
            {"chartType":"banana","title":"T","dimension":{"column":"region"},
             "measures":[{"column":"revenue","aggregation":"sum"}]}""")
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("INVALID_CHART_SPEC"));
    }

    @Test
    void malformedJsonBodyIs400() throws Exception {
        renderRaw("{not json")
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("INVALID_CHART_SPEC"));
    }

    @Test
    void missingDatasetIs404() throws Exception {
        renderRaw("""
            {"datasetId":"00000000-0000-0000-0000-000000000000",
             "spec":{"chartType":"bar","title":"T","dimension":{"column":"region"},
                     "measures":[{"column":"revenue","aggregation":"sum"}]}}""")
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error").value("NOT_FOUND"));
    }

    @Test
    void limitOutOfRangeIs400() throws Exception {
        render("""
            {"chartType":"bar","title":"T","dimension":{"column":"region"},
             "measures":[{"column":"revenue","aggregation":"sum"}],"limit":0}""")
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("INVALID_CHART_SPEC"));
    }
}
