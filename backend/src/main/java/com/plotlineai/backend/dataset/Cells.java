package com.plotlineai.backend.dataset;

import com.plotlineai.backend.dataset.dto.ColumnSchema;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.Locale;
import java.util.Set;

/**
 * Reads one trimmed cell the way its column was typed. Inference and rendering both go through
 * here, so a value the schema counted as missing is skipped everywhere, and a formatted number
 * such as {@code $1,234.50} means the same thing to every reader.
 */
public final class Cells {

    private static final Set<String> BOOLEANS = Set.of("true", "false", "yes", "no", "y", "n");

    private Cells() {
    }

    /** true/false, yes/no or y/n, in any case. */
    public static boolean isBoolean(String value) {
        return BOOLEANS.contains(value.toLowerCase(Locale.ROOT));
    }

    /** The number in a numeric column's cell, or {@code null} when it holds none. */
    public static BigDecimal number(String value, ColumnSchema col) {
        return NumberFormats.parse(value, col.format());
    }

    /** The date in a date column's cell, or {@code null} when it holds none. */
    public static LocalDate date(String value, ColumnSchema col) {
        if (value.isEmpty()) {
            return null;
        }
        try {
            return DateFormats.parseDate(value, col.format());
        } catch (DateTimeParseException e) {
            return null;
        }
    }

    /** Whether the cell holds a value of its column's type. */
    public static boolean isPresent(String value, ColumnSchema col) {
        if (value.isEmpty()) {
            return false;
        }
        return switch (col.type()) {
            case STRING -> true;
            case INTEGER, DECIMAL -> number(value, col) != null;
            case DATE -> date(value, col) != null;
            case BOOLEAN -> isBoolean(value);
        };
    }
}
