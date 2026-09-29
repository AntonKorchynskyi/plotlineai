package com.plotlineai.backend.dataset;

import static org.junit.jupiter.api.Assertions.*;

import com.plotlineai.backend.error.CapExceededException;
import com.plotlineai.backend.error.CsvParseException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;

class CsvParserTest {

    private final DatasetCapsProperties caps =
        new DatasetCapsProperties(5_242_880L, 100_000, 256, 32_768, Duration.ofDays(7), 20, 300);
    private final CsvParser parser = new CsvParser(caps);

    private byte[] fixture(String name) throws Exception {
        return Files.readAllBytes(Path.of("src/test/resources/testdata/" + name));
    }

    @Test
    void parsesCommaCsv() throws Exception {
        ParsedCsv csv = parser.parse(fixture("sample.csv"));
        assertEquals(List.of("name", "age", "active", "joined"), csv.headers());
        assertEquals(3, csv.rows().size());
        assertEquals(List.of("Alice", "34", "true", "2024-01-15"), csv.rows().get(0));
    }

    @Test
    void sniffsSemicolonDelimiter() throws Exception {
        ParsedCsv csv = parser.parse(fixture("semicolons.csv"));
        assertEquals(List.of("name", "age", "active", "joined"), csv.headers());
        assertEquals(2, csv.rows().size());
    }

    @Test
    void sniffsTabDelimiter() throws Exception {
        ParsedCsv csv = parser.parse(fixture("tabs.csv"));
        assertEquals(4, csv.headers().size());
        assertEquals(List.of("Alice", "34", "true", "2024-01-15"), csv.rows().get(0));
    }

    @Test
    void quoteAwareSniffingIgnoresSemicolonsInsideQuotes() {
        byte[] bytes = "id,\"Notes; comments; misc\"\nAlice,5\n".getBytes(StandardCharsets.UTF_8);
        ParsedCsv csv = parser.parse(bytes);
        assertEquals(List.of("id", "Notes; comments; misc"), csv.headers());
    }

    @Test
    void parsesQuotedFieldContainingDelimiter() {
        ParsedCsv csv = parser.parse("a,b\n\"x,y\",2\n".getBytes(StandardCharsets.UTF_8));
        assertEquals(List.of("x,y", "2"), csv.rows().get(0));
    }

    @Test
    void parsesEmbeddedNewlineInQuotedCell() {
        ParsedCsv csv = parser.parse(
            "a,b\n\"line1\nline2\",2\n".getBytes(StandardCharsets.UTF_8));
        assertEquals(1, csv.rows().size());
    }

    @Test
    void parsesCrlfInput() {
        ParsedCsv csv = parser.parse("a,b\r\n1,2\r\n".getBytes(StandardCharsets.UTF_8));
        assertEquals(List.of("a", "b"), csv.headers());
        assertEquals(List.of("1", "2"), csv.rows().get(0));
    }

    @Test
    void rowCapBoundaryAllowsExactlyMaxRows() {
        var caps2 = new DatasetCapsProperties(5_242_880L, 2, 256, 32_768, Duration.ofDays(7), 20, 300);
        var p = new CsvParser(caps2);
        ParsedCsv csv = p.parse("a\n1\n2\n".getBytes(StandardCharsets.UTF_8));
        assertEquals(2, csv.rows().size());
    }

    @Test
    void stripsUtf8Bom() throws Exception {
        ParsedCsv csv = parser.parse(fixture("bom.csv"));
        assertEquals("name", csv.headers().get(0));
    }

    @Test
    void rejectsInvalidUtf8() throws Exception {
        byte[] bytes = fixture("binary.csv");
        assertThrows(CsvParseException.class, () -> parser.parse(bytes));
    }

    @Test
    void rejectsEmptyInput() {
        assertThrows(CsvParseException.class, () -> parser.parse(new byte[0]));
        assertThrows(CsvParseException.class,
            () -> parser.parse("\n\n".getBytes(StandardCharsets.UTF_8)));
    }

    @Test
    void rejectsDuplicateHeaders() {
        byte[] bytes = "a,b,a\n1,2,3\n".getBytes(StandardCharsets.UTF_8);
        assertThrows(CsvParseException.class, () -> parser.parse(bytes));
    }

    @Test
    void abbreviatesALongDuplicateNameInTheMessage() {
        String longName = "x".repeat(5000);
        byte[] bytes = (longName + "," + longName + "\n1,2\n").getBytes(StandardCharsets.UTF_8);
        var ex = assertThrows(CsvParseException.class, () -> parser.parse(bytes));
        assertTrue(ex.getMessage().length() < 100, ex.getMessage());
        assertTrue(ex.getMessage().endsWith("..."));
    }

    @Test
    void rejectsBlankHeader() {
        byte[] bytes = "a,,c\n1,2,3\n".getBytes(StandardCharsets.UTF_8);
        assertThrows(CsvParseException.class, () -> parser.parse(bytes));
    }

    @Test
    void enforcesRowCap() {
        var caps2 = new DatasetCapsProperties(5_242_880L, 2, 256, 32_768, Duration.ofDays(7), 20, 300);
        var p = new CsvParser(caps2);
        byte[] bytes = "a\n1\n2\n3\n".getBytes(StandardCharsets.UTF_8);
        assertThrows(CapExceededException.class, () -> p.parse(bytes));
    }

    @Test
    void enforcesColumnCap() {
        var caps2 = new DatasetCapsProperties(5_242_880L, 100_000, 2, 32_768, Duration.ofDays(7), 20, 300);
        var p = new CsvParser(caps2);
        byte[] bytes = "a,b,c\n1,2,3\n".getBytes(StandardCharsets.UTF_8);
        assertThrows(CapExceededException.class, () -> p.parse(bytes));
    }

    @Test
    void enforcesCellCap() {
        var caps2 = new DatasetCapsProperties(5_242_880L, 100_000, 256, 4, Duration.ofDays(7), 20, 300);
        var p = new CsvParser(caps2);
        byte[] bytes = "a\nhello-world\n".getBytes(StandardCharsets.UTF_8);
        assertThrows(CapExceededException.class, () -> p.parse(bytes));
    }

    @Test
    void padsShortRowsAndKeepsRaggedLongRowsAsError() {
        // short row -> padded with nulls-as-empty; longer-than-header row -> CsvParseException
        ParsedCsv ok = parser.parse("a,b\n1\n".getBytes(StandardCharsets.UTF_8));
        assertEquals(List.of("1", ""), ok.rows().get(0));
        assertThrows(CsvParseException.class,
            () -> parser.parse("a,b\n1,2,3\n".getBytes(StandardCharsets.UTF_8)));
    }

    @Test
    void rejectsHeaderOnlyInput() {
        assertThrows(CsvParseException.class,
            () -> parser.parse("a,b,c\n".getBytes(StandardCharsets.UTF_8)));
    }

    @Test
    void trimsHeadersButNotCellValues() throws Exception {
        ParsedCsv csv = parser.parse(" a , b \n x , y \n".getBytes(StandardCharsets.UTF_8));
        assertEquals(List.of("a", "b"), csv.headers());
        assertEquals(List.of(" x ", " y "), csv.rows().get(0));
    }
}
