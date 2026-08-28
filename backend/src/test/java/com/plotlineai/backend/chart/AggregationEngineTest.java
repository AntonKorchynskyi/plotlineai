package com.plotlineai.backend.chart;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.plotlineai.backend.chart.dto.RenderResponse;
import com.plotlineai.backend.chart.spec.ChartSpec;
import com.plotlineai.backend.dataset.ColumnType;
import com.plotlineai.backend.dataset.dto.ColumnSchema;
import com.plotlineai.backend.error.InvalidChartSpecException;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

class AggregationEngineTest {

    private static final ObjectMapper MAPPER = JsonMapper.builder().build();

    private static final List<ColumnSchema> SCHEMA = List.of(
        new ColumnSchema("region", ColumnType.STRING, 3, 0, null),
        new ColumnSchema("joined", ColumnType.DATE, 6, 0, "yyyy-MM-dd"),
        new ColumnSchema("revenue", ColumnType.DECIMAL, 6, 0, null),
        new ColumnSchema("units", ColumnType.INTEGER, 6, 0, null));

    private static final List<List<String>> ROWS = List.of(
        List.of("north", "2024-01-15", "10.5", "1"),
        List.of("south", "2024-01-20", "20.0", "2"),
        List.of("north", "2024-02-10", "30.0", "3"),
        List.of("south", "2024-04-01", "5.5", "4"),
        List.of("north", "2025-01-05", "100.0", "5"),
        List.of("west", "2024-01-31", "1.0", "6"));

    private final AggregationEngine engine = new AggregationEngine();

    private static ChartSpec spec(String json) {
        return MAPPER.readValue(json, ChartSpec.class);
    }

    private RenderResponse render(String json) {
        return engine.render(spec(json), SCHEMA, ROWS);
    }

    @Test
    void sumByStringDimensionSortsLabelsAscending() {
        RenderResponse r = render("""
            {"chartType":"bar","title":"T","dimension":{"column":"region"},
             "measures":[{"column":"revenue","aggregation":"sum"}]}""");
        assertEquals("bar", r.chartType());
        assertEquals(false, r.stacked());
        assertEquals(List.of("north", "south", "west"), r.labels());
        assertEquals(1, r.datasets().size());
        assertEquals("sum(revenue)", r.datasets().get(0).label());
        assertEquals(List.of(140.5, 25.5, 1.0), r.datasets().get(0).data());
    }

    @Test
    void avgMinMaxAndCounts() {
        RenderResponse r = render("""
            {"chartType":"bar","title":"T","dimension":{"column":"region"},
             "measures":[{"column":"units","aggregation":"avg"},
                         {"column":"units","aggregation":"min"},
                         {"column":"units","aggregation":"max"},
                         {"column":null,"aggregation":"count"}]}""");
        assertEquals(List.of(3.0, 3.0, 6.0), r.datasets().get(0).data());   // avg
        assertEquals(List.of(1.0, 2.0, 6.0), r.datasets().get(1).data());   // min
        assertEquals(List.of(5.0, 4.0, 6.0), r.datasets().get(2).data());   // max
        assertEquals("count", r.datasets().get(3).label());
        assertEquals(List.of(3.0, 2.0, 1.0), r.datasets().get(3).data());   // count
    }

    @Test
    void countWithColumnCountsNonEmptyCells() {
        List<List<String>> rows = List.of(
            List.of("north", "2024-01-15", "", "1"),
            List.of("north", "2024-01-16", "5.0", "2"));
        RenderResponse r = engine.render(spec("""
            {"chartType":"bar","title":"T","dimension":{"column":"region"},
             "measures":[{"column":"revenue","aggregation":"count"}]}"""), SCHEMA, rows);
        assertEquals(List.of(1.0), r.datasets().get(0).data());
    }

    @Test
    void monthBucketGroupsChronologically() {
        RenderResponse r = render("""
            {"chartType":"line","title":"T","dimension":{"column":"joined","bucket":"month"},
             "measures":[{"column":"revenue","aggregation":"sum"}]}""");
        assertEquals(List.of("2024-01", "2024-02", "2024-04", "2025-01"), r.labels());
        assertEquals(List.of(31.5, 30.0, 5.5, 100.0), r.datasets().get(0).data());
    }

    @Test
    void quarterYearWeekAndDayBuckets() {
        RenderResponse q = render("""
            {"chartType":"line","title":"T","dimension":{"column":"joined","bucket":"quarter"},
             "measures":[{"column":null,"aggregation":"count"}]}""");
        assertEquals(List.of("2024-Q1", "2024-Q2", "2025-Q1"), q.labels());

        RenderResponse y = render("""
            {"chartType":"line","title":"T","dimension":{"column":"joined","bucket":"year"},
             "measures":[{"column":null,"aggregation":"count"}]}""");
        assertEquals(List.of("2024", "2025"), y.labels());
        assertEquals(List.of(5.0, 1.0), y.datasets().get(0).data());

        RenderResponse w = render("""
            {"chartType":"line","title":"T","dimension":{"column":"joined","bucket":"week"},
             "measures":[{"column":null,"aggregation":"count"}]}""");
        // Mondays: 2024-01-15, 2024-01-15(20th->15th), 2024-02-05, 2024-04-01, 2024-01-29, 2024-12-30(2025-01-05->Mon Dec30)
        assertEquals(List.of("2024-01-15", "2024-01-29", "2024-02-05", "2024-04-01", "2024-12-30"),
            w.labels());

        RenderResponse d = render("""
            {"chartType":"line","title":"T","dimension":{"column":"joined","bucket":"day"},
             "measures":[{"column":null,"aggregation":"count"}]}""");
        assertEquals(6, d.labels().size());
        assertEquals("2024-01-15", d.labels().get(0));
    }

    @Test
    void dateDimensionWithoutBucketSortsChronologically() {
        RenderResponse r = render("""
            {"chartType":"line","title":"T","dimension":{"column":"joined"},
             "measures":[{"column":"revenue","aggregation":"sum"}]}""");
        assertEquals("2024-01-15", r.labels().get(0));
        assertEquals("2025-01-05", r.labels().get(5));
    }

    @Test
    void numericDimensionSortsNumerically() {
        RenderResponse r = render("""
            {"chartType":"bar","title":"T","dimension":{"column":"units"},
             "measures":[{"column":null,"aggregation":"count"}]}""");
        assertEquals(List.of("1", "2", "3", "4", "5", "6"), r.labels());
    }

    @Test
    void everyFilterOpWorks() {
        RenderResponse eq = render("""
            {"chartType":"bar","title":"T","dimension":{"column":"region"},
             "measures":[{"column":null,"aggregation":"count"}],
             "filters":[{"column":"region","op":"eq","value":"north"}]}""");
        assertEquals(List.of("north"), eq.labels());

        RenderResponse neq = render("""
            {"chartType":"bar","title":"T","dimension":{"column":"region"},
             "measures":[{"column":null,"aggregation":"count"}],
             "filters":[{"column":"region","op":"neq","value":"north"}]}""");
        assertEquals(List.of("south", "west"), neq.labels());

        RenderResponse in = render("""
            {"chartType":"bar","title":"T","dimension":{"column":"region"},
             "measures":[{"column":null,"aggregation":"count"}],
             "filters":[{"column":"region","op":"in","value":["north","west"]}]}""");
        assertEquals(List.of("north", "west"), in.labels());

        RenderResponse gt = render("""
            {"chartType":"bar","title":"T","dimension":{"column":"region"},
             "measures":[{"column":null,"aggregation":"count"}],
             "filters":[{"column":"units","op":"gt","value":4}]}""");
        assertEquals(List.of(1.0, 1.0), gt.datasets().get(0).data()); // units 5,6 -> north,west

        RenderResponse dateLte = render("""
            {"chartType":"bar","title":"T","dimension":{"column":"region"},
             "measures":[{"column":null,"aggregation":"count"}],
             "filters":[{"column":"joined","op":"lte","value":"2024-01-31"}]}""");
        assertEquals(List.of(1.0, 1.0, 1.0), dateLte.datasets().get(0).data());

        RenderResponse gte = render("""
            {"chartType":"bar","title":"T","dimension":{"column":"region"},
             "measures":[{"column":null,"aggregation":"count"}],
             "filters":[{"column":"units","op":"gte","value":6},
                        {"column":"units","op":"lt","value":7}]}""");
        assertEquals(List.of("west"), gte.labels());
    }

    @Test
    void emptyDimensionCellsAreSkipped() {
        List<List<String>> rows = List.of(
            List.of("", "2024-01-15", "10.0", "1"),
            List.of("north", "2024-01-16", "20.0", "2"));
        RenderResponse r = engine.render(spec("""
            {"chartType":"bar","title":"T","dimension":{"column":"region"},
             "measures":[{"column":null,"aggregation":"count"}]}"""), SCHEMA, rows);
        assertEquals(List.of("north"), r.labels());
    }

    @Test
    void measureWithNoParseableCellsYieldsNull() {
        List<List<String>> rows = List.of(
            List.of("north", "2024-01-15", "", "1"),
            List.of("south", "2024-01-16", "5.0", "2"));
        RenderResponse r = engine.render(spec("""
            {"chartType":"bar","title":"T","dimension":{"column":"region"},
             "measures":[{"column":"revenue","aggregation":"sum"}]}"""), SCHEMA, rows);
        assertNull(r.datasets().get(0).data().get(0));
        assertEquals(5.0, r.datasets().get(0).data().get(1));
    }

    @Test
    void emptyDatasetRendersEmptyResponse() {
        RenderResponse r = engine.render(spec("""
            {"chartType":"bar","title":"T","dimension":{"column":"region"},
             "measures":[{"column":"revenue","aggregation":"sum"}]}"""), SCHEMA, List.of());
        assertEquals(List.of(), r.labels());
        assertEquals(List.of(), r.datasets().get(0).data());
    }

    @Test
    void measureLabelOverrideIsUsed() {
        RenderResponse r = render("""
            {"chartType":"bar","title":"T","dimension":{"column":"region"},
             "measures":[{"column":"revenue","aggregation":"sum","label":"Revenue"}]}""");
        assertEquals("Revenue", r.datasets().get(0).label());
    }

    @Test
    void tooManyGroupsIsRejected() {
        List<List<String>> rows = new ArrayList<>();
        for (int i = 0; i < 1001; i++) {
            rows.add(List.of("region-" + i, "2024-01-15", "1.0", "1"));
        }
        assertThrows(InvalidChartSpecException.class, () -> engine.render(spec("""
            {"chartType":"bar","title":"T","dimension":{"column":"region"},
             "measures":[{"column":null,"aggregation":"count"}]}"""), SCHEMA, rows));
    }

    @Test
    void raggedRowsAreTolerated() {
        List<List<String>> rows = List.of(
            List.of("north", "2024-01-15", "10.0", "1"),
            List.of("south"));
        RenderResponse r = engine.render(spec("""
            {"chartType":"bar","title":"T","dimension":{"column":"region"},
             "measures":[{"column":"revenue","aggregation":"sum"}]}"""), SCHEMA, rows);
        assertEquals(List.of("north", "south"), r.labels());
        assertNull(r.datasets().get(0).data().get(1));
    }
}
