package com.plotlineai.backend.dataset;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class NumberFormatsTest {

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
        "number:decorated | $37300.00 | 37300.00",
        "number:decorated | 45% | 45",
        "number:decorated | 45 % | 45",
        "number:decorated | (12) | -12",
        "number:decorated | ($12.50) | -12.50",
        "number:decorated | -$5 | -5",
        "number:decorated | $-5 | -5",
        "number:decorated | € 7 | 7",
        "number:grouped | 1,234,567.89 | 1234567.89",
        "number:grouped | $1,234 | 1234",
        "number:grouped | 999 | 999",
        "number:eu | 1.234.567,89 | 1234567.89",
        "number:eu | 1 234,5 | 1234.5",
        "number:eu | 12,50 € | 12.50",
        "number:eu | 258606785,8 | 258606785.8",
    })
    void parsesEachForm(String format, String value, String expected) {
        assertEquals(new BigDecimal(expected), NumberFormats.parse(value, format));
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
        "number:grouped | 12,34",
        "number:grouped | 1,2345",
        "number:grouped | ,123",
        "number:grouped | 1,234,",
        "number:eu | 1.5",
        "number:eu | 1,",
        "number:decorated | 1,234",
        "number:decorated | $",
        "number:decorated | 12 in",
        "number:decorated | 1e5",
        "number:decorated | --5",
    })
    void refusesWhatDoesNotFit(String format, String value) {
        assertNull(NumberFormats.parse(value, format));
    }

    @Test
    void plainIsWhatBigDecimalReads() {
        assertEquals(new BigDecimal("1E+5"), NumberFormats.parse("1e5", null));
        assertNull(NumberFormats.parse("1,234", null));
        assertNull(NumberFormats.parse("", null));
    }

    @Test
    void noBreakSpacesGroupLikeSpaces() {
        assertEquals(new BigDecimal("1234.5"), NumberFormats.parse("1\u00A0234,5", NumberFormats.EU));
        assertEquals(new BigDecimal("1234.5"), NumberFormats.parse("1\u202F234,5", NumberFormats.EU));
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
        "6 in | number:unit:in | 6",
        "177 in | number:unit:in | 177",
        "3.5 km | number:unit:km | 3.5",
        "1,234 kg | number:unit:kg | 1234",
        "-4 °C | number:unit:°C | -4",
        "20 m/s | number:unit:m/s | 20",
        "12 m² | number:unit:m² | 12",
    })
    void readsANumberFollowedByAUnit(String value, String label, String expected) {
        assertEquals(label, NumberFormats.unitLabel(value));
        assertEquals(new BigDecimal(expected), NumberFormats.parse(value, label));
        assertTrue(NumberFormats.isLabel(label));
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
        "10B", "6in", "6 ", "in", "12 Jan", "3 September", "5 bedroomsss", "4 a1", "7 in in", "2024 Q1",
    })
    void doesNotTakeCodesDatesOrLongWordsForAUnit(String value) {
        assertNull(NumberFormats.unitLabel(value), value);
    }

    @Test
    void aUnitColumnReadsOnlyItsOwnUnit() {
        String label = NumberFormats.unitLabel("6 in");
        assertNull(NumberFormats.parse("6 cm", label));
        assertNull(NumberFormats.parse("6", label));
        assertNull(NumberFormats.parse("six in", label));
        assertEquals(new BigDecimal("6"), NumberFormats.parse("6  in", label));
    }

    @Test
    void unitLabelsAreAClosedShape() {
        assertTrue(NumberFormats.isLabel("number:unit:in"));
        assertTrue(!NumberFormats.isLabel("number:unit:"));
        assertTrue(!NumberFormats.isLabel("number:unit:way too long"));
        assertTrue(!NumberFormats.isLabel("number:unit:<b>"));
        assertThrows(IllegalArgumentException.class, () -> NumberFormats.parse("6 x", "number:unit:<b>"));
        assertEquals("in", NumberFormats.unitOf("number:unit:in"));
        assertNull(NumberFormats.unitOf(NumberFormats.GROUPED));
        assertNull(NumberFormats.unitOf(null));
    }

    @Test
    void unknownLabelThrows() {
        assertThrows(IllegalArgumentException.class, () -> NumberFormats.parse("1", "number:other"));
    }

    @Test
    void hostileCellsCostLinearTime() {
        List<String> hostile = List.of("9".repeat(32_768), "1,".repeat(16_384), "(".repeat(32_768),
            "$" + "0".repeat(32_767), "1.".repeat(16_384) + ",5");
        long start = System.nanoTime();
        for (int i = 0; i < 100; i++) {
            for (String value : hostile) {
                for (String format : List.of(NumberFormats.GROUPED, NumberFormats.EU, NumberFormats.DECORATED)) {
                    NumberFormats.parse(value, format);
                }
                NumberFormats.parse(value, null);
            }
        }
        assertTrue(System.nanoTime() - start < 2_000_000_000L, "parsing took too long");
    }
}
