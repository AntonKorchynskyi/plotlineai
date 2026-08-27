package com.plotlineai.backend.dataset;

import com.plotlineai.backend.error.CapExceededException;
import com.plotlineai.backend.error.CsvParseException;
import java.io.IOException;
import java.io.StringReader;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVParser;
import org.apache.commons.csv.CSVRecord;

public class CsvParser {

    private static final byte[] UTF8_BOM = {(byte) 0xEF, (byte) 0xBB, (byte) 0xBF};

    private final DatasetCapsProperties caps;

    public CsvParser(DatasetCapsProperties caps) {
        this.caps = caps;
    }

    public ParsedCsv parse(byte[] bytes) {
        String text = decodeStrictUtf8(stripBom(bytes));
        if (text.isBlank()) {
            throw new CsvParseException("The file is empty");
        }
        char delimiter = sniffDelimiter(text);
        try (CSVParser csv = CSVFormat.DEFAULT.builder()
                .setDelimiter(delimiter)
                .setTrim(false)
                .get()
                .parse(new StringReader(text))) {
            var iterator = csv.iterator();
            if (!iterator.hasNext()) {
                throw new CsvParseException("The file has no header row");
            }
            List<String> headers = toList(iterator.next());
            validateHeaders(headers);
            List<List<String>> rows = new ArrayList<>();
            while (iterator.hasNext()) {
                CSVRecord record = iterator.next();
                if (rows.size() >= caps.maxRows()) {
                    throw new CapExceededException(
                        "The file exceeds the maximum of " + caps.maxRows() + " rows");
                }
                rows.add(normalizeRow(record, headers.size()));
            }
            if (rows.isEmpty()) {
                throw new CsvParseException("The file has a header but no data rows");
            }
            return new ParsedCsv(headers, rows);
        } catch (IOException | IllegalStateException e) {
            throw new CsvParseException("The file could not be parsed as CSV");
        }
    }

    private byte[] stripBom(byte[] bytes) {
        if (bytes.length >= 3 && bytes[0] == UTF8_BOM[0] && bytes[1] == UTF8_BOM[1]
                && bytes[2] == UTF8_BOM[2]) {
            byte[] out = new byte[bytes.length - 3];
            System.arraycopy(bytes, 3, out, 0, out.length);
            return out;
        }
        return bytes;
    }

    private String decodeStrictUtf8(byte[] bytes) {
        try {
            return StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes))
                .toString();
        } catch (CharacterCodingException e) {
            throw new CsvParseException("The file is not valid UTF-8 text");
        }
    }

    private char sniffDelimiter(String text) {
        String firstLine = text.lines().findFirst().orElse("");
        long commas = 0;
        long semis = 0;
        long tabs = 0;
        boolean inQuotes = false;
        for (int i = 0; i < firstLine.length(); i++) {
            char ch = firstLine.charAt(i);
            if (ch == '"') {
                inQuotes = !inQuotes;
            } else if (!inQuotes) {
                if (ch == ',') commas++;
                else if (ch == ';') semis++;
                else if (ch == '\t') tabs++;
            }
        }
        if (semis > commas && semis >= tabs) return ';';
        if (tabs > commas && tabs > semis) return '\t';
        return ',';
    }

    private void validateHeaders(List<String> headers) {
        if (headers.size() > caps.maxColumns()) {
            throw new CapExceededException(
                "The file exceeds the maximum of " + caps.maxColumns() + " columns");
        }
        var seen = new HashSet<String>();
        for (String h : headers) {
            if (h.length() > caps.maxCellChars()) {
                throw new CapExceededException(
                    "A cell exceeds the maximum of " + caps.maxCellChars() + " characters");
            }
            String trimmed = h.trim();
            if (trimmed.isEmpty()) {
                throw new CsvParseException("Header row contains a blank column name");
            }
            if (!seen.add(trimmed)) {
                throw new CsvParseException("Duplicate column name: " + trimmed);
            }
        }
    }

    private List<String> normalizeRow(CSVRecord record, int width) {
        if (record.size() > width) {
            throw new CsvParseException(
                "Row " + record.getRecordNumber() + " has more cells than the header");
        }
        List<String> row = new ArrayList<>(width);
        for (int i = 0; i < width; i++) {
            String value = i < record.size() ? record.get(i) : "";
            if (value.length() > caps.maxCellChars()) {
                throw new CapExceededException(
                    "A cell exceeds the maximum of " + caps.maxCellChars() + " characters");
            }
            row.add(value);
        }
        return row;
    }

    private List<String> toList(CSVRecord record) {
        List<String> out = new ArrayList<>(record.size());
        record.forEach(v -> out.add(v.trim()));
        return out;
    }
}
