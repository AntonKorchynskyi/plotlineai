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
    void hugeIntegerBeyondLongIsDecimal() {
        ColumnSchema col = inferrer.infer(csvOf("c", "99999999999999999999")).get(0);
        assertEquals(ColumnType.DECIMAL, col.type());
    }
}
