package com.plotlineai.backend.dataset;

import com.plotlineai.backend.error.CapExceededException;
import com.plotlineai.backend.error.CsvParseException;
import java.io.IOException;
import java.io.StringReader;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVParser;
import org.apache.commons.csv.CSVRecord;

/**
 * Reads an upload into a header and rows. It forgives what exports commonly get wrong (a
 * windows-1252 encoding, a trailing comma on every line, a blank or repeated column name) and
 * refuses only what cannot be read as a table.
 */
public class CsvParser {

    private static final char[] DELIMITERS = {',', ';', '\t', '|'};

    /** How many records, and characters, delimiter sniffing looks at. */
    private static final int SNIFF_RECORDS = 10;
    private static final int SNIFF_CHARS = 64 * 1024;

    private final DatasetCapsProperties caps;

    public CsvParser(DatasetCapsProperties caps) {
        this.caps = caps;
    }

    public ParsedCsv parse(byte[] bytes) {
        CsvDecoder.Decoded decoded = CsvDecoder.decode(bytes);
        String text = decoded.text();
        if (text.isBlank()) {
            throw new CsvParseException("empty", "The file is empty");
        }
        Character declared = declaredDelimiter(text);
        if (declared != null) {
            text = text.substring(text.indexOf('\n') + 1);
        }
        char delimiter = declared != null ? declared : sniffDelimiter(text);
        try (CSVParser csv = CSVFormat.DEFAULT.builder()
                .setDelimiter(delimiter)
                .setTrim(false)
                .get()
                .parse(new StringReader(text))) {
            var iterator = csv.iterator();
            if (!iterator.hasNext()) {
                throw new CsvParseException("no_header", "The file has no header row");
            }
            List<String> headers = toList(iterator.next());
            validateHeaders(headers);
            List<List<String>> rows = new ArrayList<>();
            while (iterator.hasNext()) {
                CSVRecord record = iterator.next();
                if (rows.size() >= caps.maxRows()) {
                    throw new CapExceededException(
                        "too_many_rows", "The file exceeds the maximum of " + caps.maxRows() + " rows");
                }
                rows.add(normalizeRow(record, headers.size()));
            }
            if (rows.isEmpty()) {
                throw new CsvParseException("no_rows", "The file has a header but no data rows");
            }
            int width = dropEmptyTrailingColumns(headers, rows);
            List<String> names = nameColumns(headers.subList(0, width));
            List<List<String>> table = width == headers.size()
                ? rows : rows.stream().map(r -> List.copyOf(r.subList(0, width))).toList();
            return new ParsedCsv(names, table, delimiter, decoded.encoding());
        } catch (IOException | IllegalStateException | UncheckedIOException e) {
            // commons-csv reports an unterminated quoted field as an UncheckedIOException
            throw new CsvParseException("unparseable", "The file could not be parsed as CSV");
        }
    }

    /** Excel's "sep=;" first line, which names the delimiter and is not part of the table. */
    private static Character declaredDelimiter(String text) {
        int newline = text.indexOf('\n');
        String first = (newline < 0 ? text : text.substring(0, newline)).strip();
        if (first.length() == 5 && first.regionMatches(true, 0, "sep=", 0, 4)) {
            char ch = first.charAt(4);
            for (char d : DELIMITERS) {
                if (ch == d) {
                    return ch;
                }
            }
        }
        return null;
    }

    /**
     * The delimiter that splits the first records into the same number of cells, preferring the
     * one with more cells, then the order of {@link #DELIMITERS}. Quote-aware, and bounded: it
     * reads at most {@link #SNIFF_RECORDS} records or {@link #SNIFF_CHARS} characters.
     */
    private char sniffDelimiter(String text) {
        int[][] counts = new int[DELIMITERS.length][SNIFF_RECORDS];
        int record = 0;
        boolean inQuotes = false;
        int end = Math.min(text.length(), SNIFF_CHARS);
        for (int i = 0; i < end && record < SNIFF_RECORDS; i++) {
            char ch = text.charAt(i);
            if (ch == '"') {
                inQuotes = !inQuotes;
            } else if (!inQuotes && ch == '\n') {
                record++;
            } else if (!inQuotes) {
                for (int d = 0; d < DELIMITERS.length; d++) {
                    if (ch == DELIMITERS[d]) {
                        counts[d][record]++;
                    }
                }
            }
        }
        int records = Math.max(1, Math.min(record, SNIFF_RECORDS));
        char best = ',';
        int bestConsistent = 0;
        int bestCount = 0;
        for (int d = 0; d < DELIMITERS.length; d++) {
            int header = counts[d][0];
            if (header == 0) {
                continue;
            }
            int consistent = 0;
            for (int r = 0; r < records; r++) {
                if (counts[d][r] == header) {
                    consistent++;
                }
            }
            if (consistent > bestConsistent || (consistent == bestConsistent && header > bestCount)) {
                best = DELIMITERS[d];
                bestConsistent = consistent;
                bestCount = header;
            }
        }
        return best;
    }

    private void validateHeaders(List<String> headers) {
        if (headers.size() > caps.maxColumns()) {
            throw new CapExceededException(
                "too_many_columns", "The file exceeds the maximum of " + caps.maxColumns() + " columns");
        }
        for (String h : headers) {
            if (h.length() > caps.maxCellChars()) {
                throw new CapExceededException(
                    "cell_too_long", "A cell exceeds the maximum of " + caps.maxCellChars() + " characters");
            }
        }
    }

    /**
     * Drops unnamed columns at the end that hold nothing: what a trailing comma on every line
     * leaves. Returns how many columns remain.
     */
    private static int dropEmptyTrailingColumns(List<String> headers, List<List<String>> rows) {
        int width = headers.size();
        while (width > 1 && headers.get(width - 1).isEmpty()) {
            int col = width - 1;
            if (rows.stream().anyMatch(r -> !r.get(col).isBlank())) {
                break;
            }
            width--;
        }
        return width;
    }

    /**
     * Gives every column a usable, unique name: a blank one becomes {@code column_3} (its
     * position), a repeat becomes {@code Sales_2}. A generated name never takes one the file
     * already uses, so no column can stand in for another.
     */
    private static List<String> nameColumns(List<String> headers) {
        Set<String> taken = new HashSet<>(headers);
        Set<String> used = new HashSet<>();
        List<String> names = new ArrayList<>(headers.size());
        for (int i = 0; i < headers.size(); i++) {
            String name = headers.get(i);
            if (name.isEmpty()) {
                name = unique("column_" + (i + 1), taken, used);
            } else if (used.contains(name)) {
                name = unique(name, taken, used);
            }
            used.add(name);
            names.add(name);
        }
        return names;
    }

    private static String unique(String base, Set<String> taken, Set<String> used) {
        if (!taken.contains(base) && !used.contains(base)) {
            return base;
        }
        for (int n = 2; ; n++) {
            String candidate = base + "_" + n;
            if (!taken.contains(candidate) && !used.contains(candidate)) {
                return candidate;
            }
        }
    }

    /** Pads a short row; a long one is kept only when its extra cells are empty. */
    private List<String> normalizeRow(CSVRecord record, int width) {
        for (int i = width; i < record.size(); i++) {
            if (!record.get(i).isBlank()) {
                throw new CsvParseException("extra_cells",
                    "Row " + record.getRecordNumber() + " has more cells than the header");
            }
        }
        List<String> row = new ArrayList<>(width);
        for (int i = 0; i < width; i++) {
            String value = i < record.size() ? record.get(i) : "";
            if (value.length() > caps.maxCellChars()) {
                throw new CapExceededException(
                    "cell_too_long", "A cell exceeds the maximum of " + caps.maxCellChars() + " characters");
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
