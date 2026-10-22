package com.plotlineai.backend.dataset;

import com.plotlineai.backend.dataset.dto.ColumnSchema;
import java.math.BigDecimal;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.function.Predicate;

/**
 * Types each column from its values. A type needs every non-missing value to fit, or, from
 * {@link #MIN_TOLERATED} values up, all but {@link #TOLERANCE} of them: one stray note in a
 * column of thousands of numbers should not make it text. Values that do not fit are counted
 * as missing, and every reader of the column skips them (see {@link Cells}).
 */
public class SchemaInferrer {

    static final int MIN_TOLERATED = 20;
    static final double TOLERANCE = 0.05;

    private record Typing(ColumnType type, String format) {
    }

    public List<ColumnSchema> infer(ParsedCsv csv) {
        List<String> numberOrder = csv.delimiter() == ';'
            ? NumberFormats.COMMA_DECIMAL_FIRST : NumberFormats.DOT_DECIMAL_FIRST;
        return java.util.stream.IntStream.range(0, csv.headers().size())
            .mapToObj(i -> inferColumn(csv.headers().get(i), csv.rows(), i, numberOrder))
            .toList();
    }

    private ColumnSchema inferColumn(String columnName, List<List<String>> rows, int colIndex,
            List<String> numberOrder) {
        List<String> nonNullValues = rows.stream()
            .map(row -> colIndex < row.size() ? row.get(colIndex).trim() : "")
            .filter(v -> !v.isEmpty())
            .toList();

        // A placeholder such as "n/a" is missing only if the rest of the column is typed
        List<String> nonPlaceholderValues = nonNullValues.stream()
            .filter(v -> !MissingValues.isPlaceholder(v))
            .toList();
        Typing typing = nonPlaceholderValues.isEmpty() ? null : inferType(nonPlaceholderValues, numberOrder);
        if (typing != null) {
            ColumnSchema typed = new ColumnSchema(columnName, typing.type(), 0, 0, typing.format());
            List<String> present = nonPlaceholderValues.stream()
                .filter(v -> Cells.isPresent(v, typed))
                .toList();
            return schema(columnName, typing, rows.size(), present);
        }
        return schema(columnName, new Typing(ColumnType.STRING, null), rows.size(), nonNullValues);
    }

    private ColumnSchema schema(String columnName, Typing typing, int rowCount, List<String> present) {
        Set<String> distinctValues = new HashSet<>(present);
        return new ColumnSchema(columnName, typing.type(), distinctValues.size(),
            rowCount - present.size(), typing.format());
    }

    /** The first type, and format, that fits; {@code null} for text. */
    private Typing inferType(List<String> values, List<String> numberOrder) {
        if (!looksLikeIdentifiers(values)) {
            Typing number = numberTyping(values, null);
            for (int i = 0; number == null && i < numberOrder.size(); i++) {
                number = numberTyping(values, numberOrder.get(i));
            }
            if (number != null) {
                return number;
            }
        }
        if (fits(values, Cells::isBoolean)) {
            return new Typing(ColumnType.BOOLEAN, null);
        }
        for (DateFormats.DateFormat df : DateFormats.ALL) {
            if (fits(values, v -> DateFormats.parses(v, df))) {
                return new Typing(ColumnType.DATE, df.label());
            }
        }
        // Last, since a unit is the loosest reading: "6 in", one unit for the whole column
        String unitLabel = values.stream().limit(UNIT_PROBE).map(NumberFormats::unitLabel)
            .filter(java.util.Objects::nonNull).findFirst().orElse(null);
        if (unitLabel != null && !looksLikeIdentifiers(values)) {
            return numberTyping(values, unitLabel);
        }
        return null;
    }

    /** How many leading values may be strays before one shows the column's unit. */
    private static final int UNIT_PROBE = 20;

    private Typing numberTyping(List<String> values, String format) {
        boolean[] integral = {true};
        boolean fits = fits(values, v -> {
            BigDecimal number = NumberFormats.parse(v, format);
            if (number == null) {
                return false;
            }
            if (number.scale() != 0 || number.unscaledValue().bitLength() >= 64) {
                integral[0] = false;
            }
            return true;
        });
        if (!fits) {
            return null;
        }
        return new Typing(integral[0] ? ColumnType.INTEGER : ColumnType.DECIMAL, format);
    }

    /**
     * Codes such as ZIPs or account numbers written with leading zeros ("02139", "0110") are
     * labels, not quantities: summing them is meaningless, and a number would drop the zeros.
     */
    private static boolean looksLikeIdentifiers(List<String> values) {
        for (String v : values) {
            if (v.length() > 1 && v.charAt(0) == '0' && Character.isDigit(v.charAt(1))) {
                return true;
            }
        }
        return false;
    }

    /**
     * Whether all but the tolerated share of {@code values} parse. The head is tried first, so a
     * text column fails each of the many date formats within a few values, not 5% of 100k rows.
     */
    private static boolean fits(List<String> values, Predicate<String> parses) {
        if (values.size() > SAMPLE && !fitsAll(values.subList(0, SAMPLE), parses)) {
            return false;
        }
        return fitsAll(values, parses);
    }

    private static final int SAMPLE = 200;

    private static boolean fitsAll(List<String> values, Predicate<String> parses) {
        int allowedMisses = values.size() >= MIN_TOLERATED ? (int) (values.size() * TOLERANCE) : 0;
        int misses = 0;
        int hits = 0;
        for (String v : values) {
            if (parses.test(v)) {
                hits++;
            } else if (++misses > allowedMisses) {
                return false;
            }
        }
        return hits > 0;
    }
}
