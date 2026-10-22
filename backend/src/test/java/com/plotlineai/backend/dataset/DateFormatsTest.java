package com.plotlineai.backend.dataset;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import org.junit.jupiter.api.Test;

class DateFormatsTest {

    @Test
    void parsesEachSupportedFormat() {
        assertEquals(LocalDate.of(2024, 3, 5), DateFormats.parseDate("2024-03-05", "yyyy-MM-dd"));
        assertEquals(LocalDate.of(2024, 3, 5), DateFormats.parseDate("2024/03/05", "yyyy/MM/dd"));
        assertEquals(LocalDate.of(2024, 3, 5), DateFormats.parseDate("03/05/2024", "MM/dd/yyyy"));
        assertEquals(LocalDate.of(2024, 3, 5),
            DateFormats.parseDate("2024-03-05T14:30:00", "yyyy-MM-dd'T'HH:mm:ss"));
    }

    @Test
    void invalidValueThrowsDateTimeParseException() {
        assertThrows(DateTimeParseException.class,
            () -> DateFormats.parseDate("not-a-date", "yyyy-MM-dd"));
        // ISO_LOCAL_DATE resolves STRICT: Feb 30 is rejected
        assertThrows(DateTimeParseException.class,
            () -> DateFormats.parseDate("2024-02-30", "yyyy-MM-dd"));
    }

    @Test
    void patternFormatsRejectImpossibleDates() {
        assertThrows(DateTimeParseException.class,
            () -> DateFormats.parseDate("2024/02/30", "yyyy/MM/dd"));
        assertThrows(DateTimeParseException.class,
            () -> DateFormats.parseDate("31/04/2024", "d/M/yyyy"));
    }

    @Test
    void reducesEveryShapeToItsDate() {
        assertEquals(LocalDate.of(2023, 9, 21),
            DateFormats.parseDate("09/21/2023 12:01:00 PM", "M/d/yyyy h:mm:ss a"));
        assertEquals(LocalDate.of(2024, 1, 15),
            DateFormats.parseDate("2024-01-15T23:30:00-05:00", "yyyy-MM-dd'T'HH:mm:ssXXX"));
        assertEquals(LocalDate.of(2019, 7, 1), DateFormats.parseDate("Jul-19", "MMM-yy"));
        assertEquals(LocalDate.of(2024, 3, 1), DateFormats.parseDate("2024-03", "yyyy-MM"));
    }

    @Test
    void everyLabelIsUnique() {
        assertEquals(DateFormats.ALL.size(),
            DateFormats.ALL.stream().map(DateFormats.DateFormat::label).distinct().count());
    }

    @Test
    void unknownLabelThrows() {
        assertThrows(IllegalArgumentException.class, () -> DateFormats.byLabel("dd.MM.yyyy"));
    }
}
