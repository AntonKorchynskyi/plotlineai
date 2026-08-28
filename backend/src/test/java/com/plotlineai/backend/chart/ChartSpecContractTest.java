package com.plotlineai.backend.chart;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.plotlineai.backend.chart.spec.Aggregation;
import com.plotlineai.backend.chart.spec.ChartSpec;
import com.plotlineai.backend.chart.spec.ChartType;
import com.plotlineai.backend.chart.spec.TimeBucket;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

class ChartSpecContractTest {

    private static final ObjectMapper MAPPER = JsonMapper.builder()
        .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
        .build();

    private static final Validator VALIDATOR =
        Validation.buildDefaultValidatorFactory().getValidator();

    // The same example specs the frontend Zod contract test will use in Phase 6.
    static Stream<String> exampleSpecs() {
        return Stream.of(
            """
            {"chartType":"bar","title":"Revenue by region",
             "dimension":{"column":"region"},
             "measures":[{"column":"revenue","aggregation":"sum"}]}
            """,
            """
            {"chartType":"line","stacked":false,"title":"Monthly average units",
             "dimension":{"column":"joined","bucket":"month"},
             "measures":[{"column":"units","aggregation":"avg","label":"avg units"}],
             "filters":[{"column":"region","op":"in","value":["north","south"]},
                        {"column":"units","op":"gte","value":10}],
             "sort":{"by":"dimension","direction":"asc"}}
            """,
            """
            {"chartType":"area","stacked":true,"title":"Stacked by region",
             "dimension":{"column":"joined","bucket":"quarter"},
             "measures":[{"column":"revenue","aggregation":"sum"}],
             "breakdown":{"column":"region"},
             "sort":{"by":"measure","direction":"desc"},"limit":10}
            """,
            """
            {"chartType":"pie","title":"Signups per region",
             "dimension":{"column":"region"},
             "measures":[{"column":null,"aggregation":"count"}]}
            """,
            """
            {"chartType":"bubble","title":"Units vs revenue",
             "dimension":{"column":"region"},
             "measures":[{"column":"units","aggregation":"none"},
                         {"column":"revenue","aggregation":"none"},
                         {"column":"score","aggregation":"none"}]}
            """);
    }

    @ParameterizedTest
    @MethodSource("exampleSpecs")
    void exampleSpecsRoundTripAndValidate(String json) {
        ChartSpec first = MAPPER.readValue(json, ChartSpec.class);
        ChartSpec second = MAPPER.readValue(MAPPER.writeValueAsString(first), ChartSpec.class);
        assertEquals(first, second);
        assertTrue(VALIDATOR.validate(first).isEmpty());
    }

    @Test
    void fieldsMapExactly() {
        ChartSpec spec = MAPPER.readValue(
            """
            {"chartType":"horizontalBar","title":"T",
             "dimension":{"column":"joined","bucket":"week"},
             "measures":[{"column":"revenue","aggregation":"max"}],"limit":5}
            """, ChartSpec.class);
        assertEquals(ChartType.horizontalBar, spec.chartType());
        assertEquals(TimeBucket.week, spec.dimension().bucket());
        assertEquals(Aggregation.max, spec.measures().get(0).aggregation());
        assertEquals(5, spec.limit());
    }

    @Test
    void unknownPropertyIsRejected() {
        assertThrows(Exception.class, () -> MAPPER.readValue(
            """
            {"chartType":"bar","title":"T","evil":1,
             "dimension":{"column":"region"},
             "measures":[{"column":null,"aggregation":"count"}]}
            """, ChartSpec.class));
    }

    @Test
    void unknownEnumValueIsRejected() {
        assertThrows(Exception.class, () -> MAPPER.readValue(
            """
            {"chartType":"banana","title":"T",
             "dimension":{"column":"region"},
             "measures":[{"column":null,"aggregation":"count"}]}
            """, ChartSpec.class));
    }

    static Stream<String> structurallyInvalidSpecs() {
        return Stream.of(
            // no measures
            """
            {"chartType":"bar","title":"T","dimension":{"column":"r"},"measures":[]}
            """,
            // 5 measures
            """
            {"chartType":"bar","title":"T","dimension":{"column":"r"},
             "measures":[{"column":null,"aggregation":"count"},{"column":null,"aggregation":"count"},
                         {"column":null,"aggregation":"count"},{"column":null,"aggregation":"count"},
                         {"column":null,"aggregation":"count"}]}
            """,
            // blank title
            """
            {"chartType":"bar","title":"  ","dimension":{"column":"r"},
             "measures":[{"column":null,"aggregation":"count"}]}
            """,
            // limit out of range
            """
            {"chartType":"bar","title":"T","dimension":{"column":"r"},
             "measures":[{"column":null,"aggregation":"count"}],"limit":0}
            """,
            // 6 filters
            """
            {"chartType":"bar","title":"T","dimension":{"column":"r"},
             "measures":[{"column":null,"aggregation":"count"}],
             "filters":[{"column":"a","op":"eq","value":"1"},{"column":"a","op":"eq","value":"1"},
                        {"column":"a","op":"eq","value":"1"},{"column":"a","op":"eq","value":"1"},
                        {"column":"a","op":"eq","value":"1"},{"column":"a","op":"eq","value":"1"}]}
            """);
    }

    @ParameterizedTest
    @MethodSource("structurallyInvalidSpecs")
    void structurallyInvalidSpecsFailBeanValidation(String json) {
        ChartSpec spec = MAPPER.readValue(json, ChartSpec.class);
        assertTrue(!VALIDATOR.validate(spec).isEmpty());
    }

    @Test
    void titleLongerThan120CharsFailsValidation() {
        ChartSpec spec = MAPPER.readValue(
            "{\"chartType\":\"bar\",\"title\":\"" + "x".repeat(121)
                + "\",\"dimension\":{\"column\":\"r\"},"
                + "\"measures\":[{\"column\":null,\"aggregation\":\"count\"}]}",
            ChartSpec.class);
        assertTrue(!VALIDATOR.validate(spec).isEmpty());
    }
}
