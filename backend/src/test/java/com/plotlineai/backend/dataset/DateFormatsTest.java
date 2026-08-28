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
    void smartResolverClampsFebThirtyOnPatternFormats() {
        // ofPattern formatters resolve SMART: Feb 30 clamps to the last day of Feb.
        // Documented boundary behavior (phase-2 followup).
        assertEquals(LocalDate.of(2024, 2, 29), DateFormats.parseDate("2024/02/30", "yyyy/MM/dd"));
    }

    @Test
    void unknownLabelThrows() {
        assertThrows(IllegalArgumentException.class, () -> DateFormats.byLabel("dd.MM.yyyy"));
    }
}
