package com.plotlineai.backend.dataset;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.YearMonth;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.time.format.DateTimeParseException;
import java.time.format.ResolverStyle;
import java.util.List;
import java.util.Locale;

/**
 * The closed set of date shapes a column can be typed with. The label is stored in the column's
 * schema and read back at render time, so a label, once shipped, must keep parsing the same way.
 * Order matters: inference takes the first format every value parses with, so the month-first
 * US shape wins over day-first when both fit (every day 12 or under).
 */
public final class DateFormats {

    /** What a format's text resolves to before it is reduced to a date. */
    enum Kind { DATE, DATE_TIME, OFFSET_DATE_TIME, YEAR_MONTH }

    public record DateFormat(DateTimeFormatter formatter, String label, Kind kind) {
    }

    private static final String DATETIME_LABEL = "yyyy-MM-dd'T'HH:mm:ss";

    public static final List<DateFormat> ALL = List.of(
        new DateFormat(DateTimeFormatter.ISO_LOCAL_DATE, "yyyy-MM-dd", Kind.DATE),
        new DateFormat(pattern("uuuu/MM/dd"), "yyyy/MM/dd", Kind.DATE),
        new DateFormat(pattern("MM/dd/uuuu"), "MM/dd/yyyy", Kind.DATE),
        new DateFormat(pattern("M/d/uuuu"), "M/d/yyyy", Kind.DATE),
        new DateFormat(pattern("d/M/uuuu"), "d/M/yyyy", Kind.DATE),
        new DateFormat(pattern("d-MMM-uuuu"), "d-MMM-yyyy", Kind.DATE),
        new DateFormat(pattern("d-MMM-uu"), "d-MMM-yy", Kind.DATE),
        new DateFormat(DateTimeFormatter.ISO_LOCAL_DATE_TIME, DATETIME_LABEL, Kind.DATE_TIME),
        new DateFormat(pattern("uuuu-MM-dd HH:mm[:ss][.SSS]"), "yyyy-MM-dd HH:mm:ss", Kind.DATE_TIME),
        new DateFormat(pattern("uuuu/MM/dd HH:mm[:ss]"), "yyyy/MM/dd HH:mm:ss", Kind.DATE_TIME),
        new DateFormat(pattern("M/d/uuuu h:mm[:ss] a"), "M/d/yyyy h:mm:ss a", Kind.DATE_TIME),
        new DateFormat(pattern("M/d/uuuu H:mm[:ss]"), "M/d/yyyy H:mm:ss", Kind.DATE_TIME),
        new DateFormat(pattern("d/M/uuuu H:mm[:ss]"), "d/M/yyyy H:mm:ss", Kind.DATE_TIME),
        new DateFormat(DateTimeFormatter.ISO_OFFSET_DATE_TIME, "yyyy-MM-dd'T'HH:mm:ssXXX",
            Kind.OFFSET_DATE_TIME),
        new DateFormat(pattern("uuuu-MM"), "yyyy-MM", Kind.YEAR_MONTH),
        new DateFormat(pattern("MMM uuuu"), "MMM yyyy", Kind.YEAR_MONTH),
        new DateFormat(pattern("MMMM uuuu"), "MMMM yyyy", Kind.YEAR_MONTH),
        new DateFormat(pattern("MMM-uu"), "MMM-yy", Kind.YEAR_MONTH));

    private DateFormats() {
    }

    /**
     * Case-insensitive ("JAN", "pm"), English month names whatever the server locale, and STRICT,
     * so Feb 30 is an error rather than a quiet Feb 29.
     */
    private static DateTimeFormatter pattern(String pattern) {
        return new DateTimeFormatterBuilder().parseCaseInsensitive().appendPattern(pattern)
            .toFormatter(Locale.ENGLISH).withResolverStyle(ResolverStyle.STRICT);
    }

    public static LocalDate parseDate(String value, String formatLabel) {
        return parse(value, byLabelFormat(formatLabel));
    }

    /** Throws {@link DateTimeParseException} when {@code value} does not fit {@code format}. */
    static LocalDate parse(String value, DateFormat format) {
        return switch (format.kind()) {
            case DATE -> LocalDate.parse(value, format.formatter());
            case DATE_TIME -> LocalDateTime.parse(value, format.formatter()).toLocalDate();
            case OFFSET_DATE_TIME -> OffsetDateTime.parse(value, format.formatter()).toLocalDate();
            case YEAR_MONTH -> YearMonth.parse(value, format.formatter()).atDay(1);
        };
    }

    static boolean parses(String value, DateFormat format) {
        try {
            parse(value, format);
            return true;
        } catch (DateTimeParseException e) {
            return false;
        }
    }

    public static DateTimeFormatter byLabel(String label) {
        return byLabelFormat(label).formatter();
    }

    private static DateFormat byLabelFormat(String label) {
        for (DateFormat df : ALL) {
            if (df.label().equals(label)) {
                return df;
            }
        }
        throw new IllegalArgumentException("Unknown date format label");
    }
}
