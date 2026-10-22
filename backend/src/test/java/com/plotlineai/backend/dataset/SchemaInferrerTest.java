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

    @ParameterizedTest
    @CsvSource({"n/a", "N/A", "NA", "#N/A", "null", "None", "NaN", "-", "--", "' n/a '"})
    void placeholderTextIsMissingInANumericColumn(String placeholder) {
        ColumnSchema col = inferrer.infer(csvOf("c", "1", placeholder, "", "3")).get(0);
        assertEquals(ColumnType.INTEGER, col.type());
        assertEquals(2, col.nullCount());
        assertEquals(2, col.cardinality());
    }

    @Test
    void placeholderTextIsMissingInDateAndBooleanColumns() {
        assertEquals(ColumnType.DATE,
            inferrer.infer(csvOf("c", "2024-01-15", "n/a")).get(0).type());
        assertEquals(ColumnType.BOOLEAN,
            inferrer.infer(csvOf("c", "true", "N/A", "false")).get(0).type());
    }

    @Test
    void placeholderTextStaysAValueInATextColumn() {
        // "NA" is North America here, not a missing value.
        ColumnSchema col = inferrer.infer(csvOf("region", "NA", "EU", "n/a", "")).get(0);
        assertEquals(ColumnType.STRING, col.type());
        assertEquals(1, col.nullCount());
        assertEquals(3, col.cardinality());
    }

    @Test
    void columnOfOnlyPlaceholdersIsString() {
        ColumnSchema col = inferrer.infer(csvOf("c", "n/a", "n/a")).get(0);
        assertEquals(ColumnType.STRING, col.type());
        assertEquals(0, col.nullCount());
        assertEquals(1, col.cardinality());
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
    void slashFebThirtyIsNotADate() {
        ParsedCsv csv = new ParsedCsv(List.of("d"), List.of(List.of("2024/02/30")));
        assertEquals(ColumnType.STRING, new SchemaInferrer().infer(csv).get(0).type());
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
        "M/d/yyyy | 1/5/2024 | 12/31/2024",
        "d/M/yyyy | 1/07/2018 | 31/12/2024",
        "d-MMM-yyyy | 15-Jan-2024 | 3-feb-2024",
        "d-MMM-yy | 15-Jan-24 | 03-Feb-24",
        "yyyy-MM-dd HH:mm:ss | 2024-01-15 10:30:00 | 2024-01-16 08:05",
        "yyyy/MM/dd HH:mm:ss | 2024/01/15 10:30:00 | 2024/01/16 08:05:00",
        "M/d/yyyy h:mm:ss a | 09/21/2023 12:01:00 PM | 9/1/2023 6:00:00 am",
        "M/d/yyyy H:mm:ss | 9/21/2023 14:01 | 9/1/2023 06:00:00",
        "d/M/yyyy H:mm:ss | 21/9/2023 14:01 | 1/9/2023 06:00:00",
        "yyyy-MM-dd'T'HH:mm:ssXXX | 2024-01-15T10:30:00Z | 2024-01-15T10:30:00.123+05:30",
        "yyyy-MM | 2024-01 | 2024-12",
        "MMM yyyy | Jan 2024 | DEC 2024",
        "MMM-yy | Jul-19 | Aug-19",
    })
    void detectsCommonExportDateShapes(String format, String first, String second) {
        ColumnSchema col = inferrer.infer(csvOf("d", first, second)).get(0);
        assertEquals(ColumnType.DATE, col.type());
        assertEquals(format, col.format());
    }

    @Test
    void monthFirstWinsWhenEveryDayIsTwelveOrLess() {
        assertEquals("MM/dd/yyyy", inferrer.infer(csvOf("d", "01/02/2024", "03/04/2024")).get(0).format());
        assertEquals("d/M/yyyy", inferrer.infer(csvOf("d", "01/02/2024", "13/04/2024")).get(0).format());
    }

    @Test
    void fiscalYearRangesStayText() {
        assertEquals(ColumnType.STRING, inferrer.infer(csvOf("y", "2017-18", "2018-19")).get(0).type());
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
        "DECIMAL | number:decorated | $37300.00 | $0.50",
        "INTEGER | number:decorated | 45% | (12)",
        "INTEGER | number:decorated | -$5 | £1200",
        "DECIMAL | number:grouped | $1,234.50 | 12,345,678.9",
        "INTEGER | number:grouped | 1,234 | 999",
        "DECIMAL | number:eu | 258606785,8 | 1.234,5",
        "DECIMAL | number:eu | 12,50 € | 3,1",
    })
    void detectsFormattedNumbers(String type, String format, String first, String second) {
        ColumnSchema col = inferrer.infer(csvOf("n", first, second)).get(0);
        assertEquals(ColumnType.valueOf(type), col.type());
        assertEquals(format, col.format());
    }

    @Test
    void plainNumbersKeepNoFormat() {
        assertNull(inferrer.infer(csvOf("n", "1.5", "2")).get(0).format());
    }

    @Test
    void semicolonFilesReadADecimalCommaFirst() {
        var semis = new ParsedCsv(List.of("n"), List.of(List.of("1,234"), List.of("2,5")), ';', "UTF-8");
        assertEquals(NumberFormats.EU, inferrer.infer(semis).get(0).format());
        var commas = new ParsedCsv(List.of("n"), List.of(List.of("1,234"), List.of("2,500")), ',', "UTF-8");
        assertEquals(NumberFormats.GROUPED, inferrer.infer(commas).get(0).format());
    }

    @Test
    void leadingZeroCodesStayText() {
        assertEquals(ColumnType.STRING, inferrer.infer(csvOf("zip", "02139", "10001")).get(0).type());
        assertEquals(ColumnType.STRING, inferrer.infer(csvOf("code", "0110", "0141")).get(0).type());
        assertEquals(ColumnType.DECIMAL, inferrer.infer(csvOf("x", "0.5", "0")).get(0).type());
    }

    @Test
    void yesNoColumnsAreBoolean() {
        assertEquals(ColumnType.BOOLEAN, inferrer.infer(csvOf("b", "Yes", "no", "Y", "n")).get(0).type());
        assertEquals(ColumnType.INTEGER, inferrer.infer(csvOf("b", "1", "0")).get(0).type());
    }

    @Test
    void aFewStraysInALongColumnAreToleratedAndCountedMissing() {
        String[] cells = new String[40];
        for (int i = 0; i < cells.length; i++) {
            cells[i] = String.valueOf(i + 1);
        }
        cells[7] = "see note";
        cells[20] = "";
        ColumnSchema col = inferrer.infer(csvOf("n", cells)).get(0);
        assertEquals(ColumnType.INTEGER, col.type());
        assertEquals(2, col.nullCount());
        assertEquals(38, col.cardinality());
    }

    @Test
    void tooManyStraysMakeText() {
        String[] cells = new String[40];
        for (int i = 0; i < cells.length; i++) {
            cells[i] = i % 10 == 0 ? "text" + i : String.valueOf(i);
        }
        assertEquals(ColumnType.STRING, inferrer.infer(csvOf("n", cells)).get(0).type());
    }

    @Test
    void shortColumnsGetNoTolerance() {
        assertEquals(ColumnType.STRING, inferrer.infer(csvOf("n", "1", "2", "x")).get(0).type());
    }

    @Test
    void largeTextColumnsAreTypedQuickly() {
        String[] cells = new String[100_000];
        for (int i = 0; i < cells.length; i++) {
            cells[i] = "free text " + i;
        }
        long start = System.nanoTime();
        assertEquals(ColumnType.STRING, inferrer.infer(csvOf("t", cells)).get(0).type());
        assertTrue(System.nanoTime() - start < 2_000_000_000L, "inference took too long");
    }
}
