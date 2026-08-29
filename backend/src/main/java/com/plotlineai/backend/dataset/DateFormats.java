package com.plotlineai.backend.dataset;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;

public final class DateFormats {

    public record DateFormat(DateTimeFormatter formatter, String label) {
    }

    private static final String DATETIME_LABEL = "yyyy-MM-dd'T'HH:mm:ss";

    public static final List<DateFormat> ALL = List.of(
        new DateFormat(DateTimeFormatter.ISO_LOCAL_DATE, "yyyy-MM-dd"),
        new DateFormat(DateTimeFormatter.ofPattern("yyyy/MM/dd"), "yyyy/MM/dd"),
        new DateFormat(DateTimeFormatter.ofPattern("MM/dd/yyyy"), "MM/dd/yyyy"),
        new DateFormat(DateTimeFormatter.ISO_LOCAL_DATE_TIME, DATETIME_LABEL));

    private DateFormats() {
    }

    public static LocalDate parseDate(String value, String formatLabel) {
        DateTimeFormatter formatter = byLabel(formatLabel);
        if (DATETIME_LABEL.equals(formatLabel)) {
            return LocalDateTime.parse(value, formatter).toLocalDate();
        }
        return LocalDate.parse(value, formatter);
    }

    public static DateTimeFormatter byLabel(String label) {
        for (DateFormat df : ALL) {
            if (df.label().equals(label)) {
                return df.formatter();
            }
        }
        throw new IllegalArgumentException("Unknown date format label");
    }
}
