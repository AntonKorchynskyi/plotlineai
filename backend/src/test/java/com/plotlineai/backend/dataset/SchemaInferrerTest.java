package com.plotlineai.backend.dataset;

import static org.junit.jupiter.api.Assertions.*;

import com.plotlineai.backend.dataset.dto.ColumnSchema;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class SchemaInferrerTest {

    private final SchemaInferrer inferrer = new SchemaInferrer();

    private ParsedCsv csvOf(String header, String... cells) {
        return new ParsedCsv(List.of(header),
            java.util.Arrays.stream(cells).map(List::of).toList());
    }

    @ParameterizedTest
    @CsvSource({
        "INTEGER, 42",
        "INTEGER, -7",
        "DECIMAL, 3.14",
        "DECIMAL, -0.5",
        "BOOLEAN, true",
        "BOOLEAN, FALSE",
        "DATE, 2024-01-15",
        "DATE, 2024/01/15",
        "DATE, 01/15/2024",
        "DATE, 2024-01-15T10:30:00",
        "STRING, hello",
        "STRING, 12abc",
    })
    void detectsSingleValueTypes(String expected, String value) {
        ColumnSchema col = inferrer.infer(csvOf("c", value)).get(0);
        assertEquals(ColumnType.valueOf(expected), col.type());
    }

    @Test
    void mixedIntegerAndDecimalIsDecimal() {
        ColumnSchema col = inferrer.infer(csvOf("c", "1", "2.5")).get(0);
        assertEquals(ColumnType.DECIMAL, col.type());
    }

    @Test
    void mixedNumberAndTextIsString() {
        ColumnSchema col = inferrer.infer(csvOf("c", "1", "x")).get(0);
        assertEquals(ColumnType.STRING, col.type());
    }

    @Test
    void mixedDateFormatsAreString() {
        // one formatter must cover the whole column
        ColumnSchema col = inferrer.infer(csvOf("c", "2024-01-15", "01/15/2024")).get(0);
        assertEquals(ColumnType.STRING, col.type());
    }

    @Test
    void nullsAreIgnoredForTypingButCounted() {
        ColumnSchema col = inferrer.infer(csvOf("c", "1", "", "3")).get(0);
        assertEquals(ColumnType.INTEGER, col.type());
        assertEquals(1, col.nullCount());
        assertEquals(2, col.cardinality());
    }

    @Test
    void allNullColumnIsString() {
        ColumnSchema col = inferrer.infer(csvOf("c", "", "")).get(0);
        assertEquals(ColumnType.STRING, col.type());
        assertEquals(2, col.nullCount());
        assertEquals(0, col.cardinality());
    }

    @Test
    void cardinalityCountsDistinctTrimmedValues() {
        ColumnSchema col = inferrer.infer(csvOf("c", "a", " a ", "b")).get(0);
        assertEquals(2, col.cardinality());
    }

    @Test
    void multiColumnKeepsHeaderOrder() {
        var csv = new ParsedCsv(List.of("n", "flag"),
            List.of(List.of("1", "true"), List.of("2", "false")));
        List<ColumnSchema> schema = inferrer.infer(csv);
        assertEquals("n", schema.get(0).name());
        assertEquals(ColumnType.INTEGER, schema.get(0).type());
        assertEquals("flag", schema.get(1).name());
        assertEquals(ColumnType.BOOLEAN, schema.get(1).type());
    }

    @Test
    void dateColumnCarriesFormatAndNonDateFormatIsNull() {
        ColumnSchema dateCol = inferrer.infer(csvOf("d", "2024-01-15", "2024-06-30")).get(0);
        assertEquals(ColumnType.DATE, dateCol.type());
        assertEquals("yyyy-MM-dd", dateCol.format());

        ColumnSchema intCol = inferrer.infer(csvOf("n", "1", "2")).get(0);
        assertEquals(ColumnType.INTEGER, intCol.type());
        assertNull(intCol.format());
    }

    @Test
    void hugeIntegerBeyondLongIsDecimal() {
        ColumnSchema col = inferrer.infer(csvOf("c", "99999999999999999999")).get(0);
        assertEquals(ColumnType.DECIMAL, col.type());
    }

    @Test
    void raggedRowIsToleratedAsEmptyCell() {
        // Defensive: CsvParser pads short rows, but the inferrer must not throw if not.
        ParsedCsv csv = new ParsedCsv(List.of("a", "b"),
            List.of(List.of("1", "2"), List.of("3")));
        List<ColumnSchema> schema = new SchemaInferrer().infer(csv);
        assertEquals(ColumnType.INTEGER, schema.get(1).type());
        assertEquals(1, schema.get(1).nullCount());
    }

    @Test
    void isoFebThirtyIsNotADate() {
        ParsedCsv csv = new ParsedCsv(List.of("d"), List.of(List.of("2024-02-30")));
        assertEquals(ColumnType.STRING, new SchemaInferrer().infer(csv).get(0).type());
    }

    @Test
    void slashFebThirtyClampsToDate() {
        ParsedCsv csv = new ParsedCsv(List.of("d"), List.of(List.of("2024/02/30")));
        List<ColumnSchema> schema = new SchemaInferrer().infer(csv);
        assertEquals(ColumnType.DATE, schema.get(0).type());
        assertEquals("yyyy/MM/dd", schema.get(0).format());
    }
}
