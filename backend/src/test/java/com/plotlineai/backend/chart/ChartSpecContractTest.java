package com.plotlineai.backend.chart;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.plotlineai.backend.chart.spec.Aggregation;
import com.plotlineai.backend.chart.spec.ChartSpec;
import com.plotlineai.backend.chart.spec.ChartType;
import com.plotlineai.backend.chart.spec.TimeBucket;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.stream.Stream;
import java.util.stream.StreamSupport;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

class ChartSpecContractTest {

    private static final ObjectMapper MAPPER = JsonMapper.builder()
        .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
        .build();

    private static final Validator VALIDATOR =
        Validation.buildDefaultValidatorFactory().getValidator();

    /**
     * The fixtures shared with the frontend Zod contract test (lib/chart-spec.test.ts), so the
     * Java record and the Zod schema are held to one set of cases and cannot drift apart.
     */
    private static final JsonNode FIXTURES = readFixtures();

    private static JsonNode readFixtures() {
        try (InputStream in = ChartSpecContractTest.class
                .getResourceAsStream("/contracts/chart-spec-fixtures.json")) {
            return MAPPER.readTree(in);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static Stream<Arguments> fixtures(String group) {
        return StreamSupport.stream(FIXTURES.get(group).spliterator(), false)
            .map(f -> Arguments.of(f.get("name").asString(), MAPPER.writeValueAsString(f.get("spec"))));
    }

    static Stream<Arguments> validFixtures() {
        return fixtures("valid");
    }

    static Stream<Arguments> invalidFixtures() {
        return fixtures("invalid");
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("validFixtures")
    void validFixturesRoundTripAndValidate(String name, String json) {
        ChartSpec first = MAPPER.readValue(json, ChartSpec.class);
        ChartSpec second = MAPPER.readValue(MAPPER.writeValueAsString(first), ChartSpec.class);
        assertEquals(first, second);
        assertTrue(VALIDATOR.validate(first).isEmpty());
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("invalidFixtures")
    void invalidFixturesAreRejected(String name, String json) {
        ChartSpec spec;
        try {
            spec = MAPPER.readValue(json, ChartSpec.class);
        } catch (Exception rejectedWhileReading) {
            return;
        }
        assertFalse(VALIDATOR.validate(spec).isEmpty(), name + " should have been rejected");
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

}
