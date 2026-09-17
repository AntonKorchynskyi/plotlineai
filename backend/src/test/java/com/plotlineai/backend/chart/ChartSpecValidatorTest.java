package com.plotlineai.backend.chart;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.plotlineai.backend.chart.spec.ChartSpec;
import com.plotlineai.backend.dataset.ColumnType;
import com.plotlineai.backend.dataset.dto.ColumnSchema;
import com.plotlineai.backend.error.InvalidChartSpecException;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

class ChartSpecValidatorTest {

    private static final ObjectMapper MAPPER = JsonMapper.builder().build();

    private static final List<ColumnSchema> SCHEMA = List.of(
        new ColumnSchema("region", ColumnType.STRING, 4, 0, null),
        new ColumnSchema("joined", ColumnType.DATE, 300, 0, "yyyy-MM-dd"),
        new ColumnSchema("revenue", ColumnType.DECIMAL, 900, 0, null),
        new ColumnSchema("units", ColumnType.INTEGER, 50, 0, null),
        new ColumnSchema("active", ColumnType.BOOLEAN, 2, 0, null),
        new ColumnSchema("customer_id", ColumnType.STRING, 5000, 0, null));

    private final ChartSpecValidator validator = new ChartSpecValidator();

    private static ChartSpec spec(String json) {
        return MAPPER.readValue(json, ChartSpec.class);
    }

    static Stream<Arguments> validSpecs() {
        return Stream.of(
            Arguments.of("bar sum by string dim", """
                {"chartType":"bar","title":"T","dimension":{"column":"region"},
                 "measures":[{"column":"revenue","aggregation":"sum"}]}"""),
            Arguments.of("line month bucket avg", """
                {"chartType":"line","title":"T","dimension":{"column":"joined","bucket":"month"},
                 "measures":[{"column":"units","aggregation":"avg"}]}"""),
            Arguments.of("pie row count", """
                {"chartType":"pie","title":"T","dimension":{"column":"region"},
                 "measures":[{"column":null,"aggregation":"count"}]}"""),
            Arguments.of("count with column", """
                {"chartType":"bar","title":"T","dimension":{"column":"region"},
                 "measures":[{"column":"customer_id","aggregation":"count"}]}"""),
            Arguments.of("stacked bar with breakdown", """
                {"chartType":"bar","stacked":true,"title":"T",
                 "dimension":{"column":"joined","bucket":"year"},
                 "measures":[{"column":"revenue","aggregation":"sum"}],
                 "breakdown":{"column":"region"}}"""),
            Arguments.of("filters of every op", """
                {"chartType":"bar","title":"T","dimension":{"column":"region"},
                 "measures":[{"column":"revenue","aggregation":"sum"}],
                 "filters":[{"column":"region","op":"eq","value":"north"},
                            {"column":"region","op":"neq","value":"south"},
                            {"column":"units","op":"gt","value":3},
                            {"column":"joined","op":"lte","value":"2024-12-31"},
                            {"column":"region","op":"in","value":["north","south"]}]}"""),
            Arguments.of("scatter", """
                {"chartType":"scatter","title":"T","dimension":{"column":"region"},
                 "measures":[{"column":"units","aggregation":"none"},
                             {"column":"revenue","aggregation":"none"}]}"""),
            Arguments.of("bubble with breakdown and limit", """
                {"chartType":"bubble","title":"T","dimension":{"column":"region"},
                 "measures":[{"column":"units","aggregation":"none"},
                             {"column":"revenue","aggregation":"none"},
                             {"column":"units","aggregation":"none"}],
                 "breakdown":{"column":"active"},"limit":50}"""),
            Arguments.of("sort by measure desc with limit", """
                {"chartType":"horizontalBar","title":"T","dimension":{"column":"region"},
                 "measures":[{"column":"revenue","aggregation":"sum"}],
                 "sort":{"by":"measure","direction":"desc"},"limit":5}"""));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("validSpecs")
    void acceptsValidSpecs(String name, String json) {
        assertDoesNotThrow(() -> validator.validate(spec(json), SCHEMA));
    }

    static Stream<Arguments> invalidSpecs() {
        return Stream.of(
            Arguments.of("unknown dimension column", """
                {"chartType":"bar","title":"T","dimension":{"column":"nope"},
                 "measures":[{"column":"revenue","aggregation":"sum"}]}"""),
            Arguments.of("unknown measure column", """
                {"chartType":"bar","title":"T","dimension":{"column":"region"},
                 "measures":[{"column":"nope","aggregation":"sum"}]}"""),
            Arguments.of("unknown breakdown column", """
                {"chartType":"bar","title":"T","dimension":{"column":"region"},
                 "measures":[{"column":"revenue","aggregation":"sum"}],
                 "breakdown":{"column":"nope"}}"""),
            Arguments.of("unknown filter column", """
                {"chartType":"bar","title":"T","dimension":{"column":"region"},
                 "measures":[{"column":"revenue","aggregation":"sum"}],
                 "filters":[{"column":"nope","op":"eq","value":"x"}]}"""),
            Arguments.of("bucket on non-date dimension", """
                {"chartType":"bar","title":"T","dimension":{"column":"region","bucket":"month"},
                 "measures":[{"column":"revenue","aggregation":"sum"}]}"""),
            Arguments.of("sum on string column", """
                {"chartType":"bar","title":"T","dimension":{"column":"region"},
                 "measures":[{"column":"customer_id","aggregation":"sum"}]}"""),
            Arguments.of("avg on boolean column", """
                {"chartType":"bar","title":"T","dimension":{"column":"region"},
                 "measures":[{"column":"active","aggregation":"avg"}]}"""),
            Arguments.of("null column without count", """
                {"chartType":"bar","title":"T","dimension":{"column":"region"},
                 "measures":[{"column":null,"aggregation":"sum"}]}"""),
            Arguments.of("none aggregation on aggregated chart", """
                {"chartType":"bar","title":"T","dimension":{"column":"region"},
                 "measures":[{"column":"revenue","aggregation":"none"}]}"""),
            Arguments.of("aggregation on scatter", """
                {"chartType":"scatter","title":"T","dimension":{"column":"region"},
                 "measures":[{"column":"units","aggregation":"sum"},
                             {"column":"revenue","aggregation":"none"}]}"""),
            Arguments.of("scatter with wrong measure count", """
                {"chartType":"scatter","title":"T","dimension":{"column":"region"},
                 "measures":[{"column":"units","aggregation":"none"}]}"""),
            Arguments.of("bubble with two measures", """
                {"chartType":"bubble","title":"T","dimension":{"column":"region"},
                 "measures":[{"column":"units","aggregation":"none"},
                             {"column":"revenue","aggregation":"none"}]}"""),
            Arguments.of("scatter with non-numeric measure", """
                {"chartType":"scatter","title":"T","dimension":{"column":"region"},
                 "measures":[{"column":"region","aggregation":"none"},
                             {"column":"revenue","aggregation":"none"}]}"""),
            Arguments.of("scatter with bucket", """
                {"chartType":"scatter","title":"T","dimension":{"column":"joined","bucket":"day"},
                 "measures":[{"column":"units","aggregation":"none"},
                             {"column":"revenue","aggregation":"none"}]}"""),
            Arguments.of("scatter with sort", """
                {"chartType":"scatter","title":"T","dimension":{"column":"region"},
                 "measures":[{"column":"units","aggregation":"none"},
                             {"column":"revenue","aggregation":"none"}],
                 "sort":{"by":"dimension","direction":"asc"}}"""),
            Arguments.of("stacked line", """
                {"chartType":"line","stacked":true,"title":"T","dimension":{"column":"region"},
                 "measures":[{"column":"revenue","aggregation":"sum"}]}"""),
            Arguments.of("pie with two measures", """
                {"chartType":"pie","title":"T","dimension":{"column":"region"},
                 "measures":[{"column":"revenue","aggregation":"sum"},
                             {"column":"units","aggregation":"sum"}]}"""),
            Arguments.of("pie with breakdown", """
                {"chartType":"doughnut","title":"T","dimension":{"column":"region"},
                 "measures":[{"column":null,"aggregation":"count"}],
                 "breakdown":{"column":"active"}}"""),
            Arguments.of("breakdown with two measures", """
                {"chartType":"bar","title":"T","dimension":{"column":"region"},
                 "measures":[{"column":"revenue","aggregation":"sum"},
                             {"column":"units","aggregation":"sum"}],
                 "breakdown":{"column":"active"}}"""),
            Arguments.of("breakdown equals dimension", """
                {"chartType":"bar","title":"T","dimension":{"column":"region"},
                 "measures":[{"column":"revenue","aggregation":"sum"}],
                 "breakdown":{"column":"region"}}"""),
            Arguments.of("breakdown cardinality above 20", """
                {"chartType":"bar","title":"T","dimension":{"column":"region"},
                 "measures":[{"column":"revenue","aggregation":"sum"}],
                 "breakdown":{"column":"customer_id"}}"""),
            Arguments.of("ordered op on string column", """
                {"chartType":"bar","title":"T","dimension":{"column":"region"},
                 "measures":[{"column":"revenue","aggregation":"sum"}],
                 "filters":[{"column":"region","op":"gt","value":"m"}]}"""),
            Arguments.of("ordered op with array value", """
                {"chartType":"bar","title":"T","dimension":{"column":"region"},
                 "measures":[{"column":"units","aggregation":"sum"}],
                 "filters":[{"column":"units","op":"gt","value":["1"]}]}"""),
            Arguments.of("numeric filter value not parseable", """
                {"chartType":"bar","title":"T","dimension":{"column":"region"},
                 "measures":[{"column":"revenue","aggregation":"sum"}],
                 "filters":[{"column":"units","op":"gte","value":"lots"}]}"""),
            Arguments.of("date filter value not parseable", """
                {"chartType":"bar","title":"T","dimension":{"column":"region"},
                 "measures":[{"column":"revenue","aggregation":"sum"}],
                 "filters":[{"column":"joined","op":"lt","value":"someday"}]}"""),
            Arguments.of("in with non-array value", """
                {"chartType":"bar","title":"T","dimension":{"column":"region"},
                 "measures":[{"column":"revenue","aggregation":"sum"}],
                 "filters":[{"column":"region","op":"in","value":"north"}]}"""),
            Arguments.of("in with empty array", """
                {"chartType":"bar","title":"T","dimension":{"column":"region"},
                 "measures":[{"column":"revenue","aggregation":"sum"}],
                 "filters":[{"column":"region","op":"in","value":[]}]}"""),
            Arguments.of("in with non-string element", """
                {"chartType":"bar","title":"T","dimension":{"column":"region"},
                 "measures":[{"column":"revenue","aggregation":"sum"}],
                 "filters":[{"column":"region","op":"in","value":[1,2]}]}"""),
            Arguments.of("eq with array value", """
                {"chartType":"bar","title":"T","dimension":{"column":"region"},
                 "measures":[{"column":"revenue","aggregation":"sum"}],
                 "filters":[{"column":"region","op":"eq","value":["north"]}]}"""));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("invalidSpecs")
    void rejectsInvalidSpecs(String name, String json) {
        assertThrows(InvalidChartSpecException.class,
            () -> validator.validate(spec(json), SCHEMA));
    }

    @org.junit.jupiter.api.Test
    void filterStringValueOver256CharsIsRejected() {
        String longValue = "a".repeat(257);
        String json = """
            {"chartType":"bar","title":"T","dimension":{"column":"region"},
             "measures":[{"column":"revenue","aggregation":"sum"}],
             "filters":[{"column":"region","op":"eq","value":"%s"}]}""".formatted(longValue);
        assertThrows(InvalidChartSpecException.class, () -> validator.validate(spec(json), SCHEMA));
    }

    @org.junit.jupiter.api.Test
    void inElementOver256CharsIsRejected() {
        String longValue = "a".repeat(257);
        String json = """
            {"chartType":"bar","title":"T","dimension":{"column":"region"},
             "measures":[{"column":"revenue","aggregation":"sum"}],
             "filters":[{"column":"region","op":"in","value":["%s"]}]}""".formatted(longValue);
        assertThrows(InvalidChartSpecException.class, () -> validator.validate(spec(json), SCHEMA));
    }

    @org.junit.jupiter.api.Test
    void filterStringValueExactly256CharsIsAccepted() {
        String value = "a".repeat(256);
        String json = """
            {"chartType":"bar","title":"T","dimension":{"column":"region"},
             "measures":[{"column":"revenue","aggregation":"sum"}],
             "filters":[{"column":"region","op":"eq","value":"%s"}]}""".formatted(value);
        assertDoesNotThrow(() -> validator.validate(spec(json), SCHEMA));
    }

    @org.junit.jupiter.api.Test
    void inElementExactly256CharsIsAccepted() {
        String value = "a".repeat(256);
        String json = """
            {"chartType":"bar","title":"T","dimension":{"column":"region"},
             "measures":[{"column":"revenue","aggregation":"sum"}],
             "filters":[{"column":"region","op":"in","value":["%s"]}]}""".formatted(value);
        assertDoesNotThrow(() -> validator.validate(spec(json), SCHEMA));
    }

    @org.junit.jupiter.api.Test
    void rejectionMessageDoesNotEchoColumnName() {
        InvalidChartSpecException ex = assertThrows(InvalidChartSpecException.class,
            () -> validator.validate(spec("""
                {"chartType":"bar","title":"T","dimension":{"column":"secret_col_xyz"},
                 "measures":[{"column":"revenue","aggregation":"sum"}]}"""), SCHEMA));
        org.junit.jupiter.api.Assertions.assertFalse(ex.getMessage().contains("secret_col_xyz"));
    }
}
