package com.plotlineai.backend.dataset;

import static org.junit.jupiter.api.Assertions.*;

import com.plotlineai.backend.error.CapExceededException;
import com.plotlineai.backend.error.CsvParseException;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Random;
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
    void suffixesRepeatedHeaders() {
        ParsedCsv csv = parse("a,b,a,a\n1,2,3,4\n");
        assertEquals(List.of("a", "b", "a_2", "a_3"), csv.headers());
    }

    @Test
    void namesBlankHeadersByPosition() {
        ParsedCsv csv = parse(",a,,c\n0,1,2,3\n");
        assertEquals(List.of("column_1", "a", "column_3", "c"), csv.headers());
    }

    @Test
    void generatedNamesNeverTakeARealOne() {
        ParsedCsv csv = parse("column_2,,a,a,a_2\n1,2,3,4,5\n");
        assertEquals(List.of("column_2", "column_2_2", "a", "a_3", "a_2"), csv.headers());
    }

    @Test
    void dropsTheEmptyColumnATrailingCommaLeaves() {
        ParsedCsv csv = parse("a,b,\n1,2,\n3,4,\n");
        assertEquals(List.of("a", "b"), csv.headers());
        assertEquals(List.of("3", "4"), csv.rows().get(1));
    }

    @Test
    void keepsAnUnnamedTrailingColumnThatHoldsData() {
        ParsedCsv csv = parse("a,b,\n1,2,x\n");
        assertEquals(List.of("a", "b", "column_3"), csv.headers());
    }

    @Test
    void acceptsTrailingEmptyCellsBeyondTheHeader() {
        ParsedCsv csv = parse("a,b\n1,2,,\n");
        assertEquals(List.of("1", "2"), csv.rows().get(0));
    }

    @Test
    void anUnterminatedQuoteIsAParseErrorNotACrash() {
        assertThrows(CsvParseException.class, () -> parse("a,b\n1,\"open\n2,3\n"));
    }

    @Test
    void sniffsPipeDelimiter() {
        ParsedCsv csv = parse("name|amount\nAlice|5\nBob|6\n");
        assertEquals(List.of("name", "amount"), csv.headers());
        assertEquals('|', csv.delimiter());
    }

    @Test
    void sniffsTheDelimiterThatIsConsistentAcrossLines() {
        // Decimal commas in the data, semicolons between cells: a typical European export
        ParsedCsv csv = parse("name;amount;rate\nAlice;1,5;2\nBob;2,5;3,25\n");
        assertEquals(List.of("name", "amount", "rate"), csv.headers());
        assertEquals(';', csv.delimiter());
        // A stray semicolon in one header cell does not outvote the consistent comma
        ParsedCsv commas = parse("id,\"note; misc\",n\n1,x,2\n2,y,3\n");
        assertEquals(',', commas.delimiter());
    }

    @Test
    void honoursExcelsSepLine() {
        ParsedCsv csv = parse("sep=;\na;b\n1,5;2\n");
        assertEquals(List.of("a", "b"), csv.headers());
        assertEquals(List.of("1,5", "2"), csv.rows().get(0));
    }

    @Test
    void readsWindows1252() {
        byte[] bytes = "city,price\nZürich,€5\n".getBytes(Charset.forName("windows-1252"));
        ParsedCsv csv = parser.parse(bytes);
        assertEquals(List.of("Zürich", "€5"), csv.rows().get(0));
        assertEquals("windows-1252", csv.encoding());
    }

    @Test
    void readsUtf16WithAByteOrderMark() {
        byte[] body = "a,b\né,2\n".getBytes(StandardCharsets.UTF_16LE);
        byte[] bytes = new byte[body.length + 2];
        bytes[0] = (byte) 0xFF;
        bytes[1] = (byte) 0xFE;
        System.arraycopy(body, 0, bytes, 2, body.length);
        ParsedCsv csv = parser.parse(bytes);
        assertEquals(List.of("é", "2"), csv.rows().get(0));
        assertEquals("UTF-16LE", csv.encoding());
    }

    @Test
    void refusesFilesThatAreNotCsvText() {
        for (String head : List.of("%PDF-1.5\n", "PK\u0003\u0004rest", "<!DOCTYPE html>\n<html>",
                "  <html lang=en>")) {
            assertThrows(CsvParseException.class,
                () -> parser.parse(head.getBytes(StandardCharsets.ISO_8859_1)), head);
        }
        byte[] ole = {(byte) 0xD0, (byte) 0xCF, 0x11, (byte) 0xE0, 'a', '\n', 'b'};
        assertThrows(CsvParseException.class, () -> parser.parse(ole));
    }

    @Test
    void refusesBinaryThatWindows1252WouldDecode() {
        byte[] bytes = new byte[2000];
        new Random(7).nextBytes(bytes);
        bytes[0] = 'a';
        assertThrows(CsvParseException.class, () -> parser.parse(bytes));
    }

    @Test
    void sniffingAHugeFirstRecordStaysFast() {
        String header = "a" + ",x".repeat(200);
        String huge = "q".repeat(3_000_000);
        long start = System.nanoTime();
        assertThrows(CapExceededException.class, () -> parse(header + "\n" + huge + "\n"));
        assertTrue(System.nanoTime() - start < 5_000_000_000L, "parsing took too long");
    }

    private ParsedCsv parse(String text) {
        return parser.parse(text.getBytes(StandardCharsets.UTF_8));
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
