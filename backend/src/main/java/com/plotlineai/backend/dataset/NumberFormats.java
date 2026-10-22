package com.plotlineai.backend.dataset;

import java.math.BigDecimal;
import java.util.List;

/**
 * How a numeric column writes its numbers. The label is stored in the column's schema, like a
 * date pattern, and every reader of the column parses its cells through {@link #parse}, so
 * inference and rendering always agree. {@code null} is the plain form {@code BigDecimal} reads.
 *
 * <p>Every form also accepts a currency sign before the number, a percent sign after it and an
 * accounting negative in parentheses: {@code $1,234.50}, {@code 45%}, {@code (12)}. Percent
 * keeps the number as written: {@code 45%} is 45. Parsing is a single hand-written pass with no
 * regular expressions, so a hostile 32k-character cell costs linear time.
 */
public final class NumberFormats {

    /** {@code 1,234.5}: comma groups of three, dot decimal. */
    public static final String GROUPED = "number:grouped";
    /** {@code 1.234,5} or {@code 1 234,5}: dot or space groups of three, comma decimal. */
    public static final String EU = "number:eu";
    /** {@code 1234.5} after a currency or percent sign or parentheses are set aside. */
    public static final String DECORATED = "number:decorated";

    /** The order inference tries the non-plain forms in; EU first for semicolon files. */
    static final List<String> COMMA_DECIMAL_FIRST = List.of(DECORATED, EU, GROUPED);
    static final List<String> DOT_DECIMAL_FIRST = List.of(DECORATED, GROUPED, EU);

    private static final String CURRENCY = "$€£¥";

    private NumberFormats() {
    }

    public static boolean isLabel(String format) {
        return GROUPED.equals(format) || EU.equals(format) || DECORATED.equals(format);
    }

    /**
     * The number {@code value} (already trimmed) holds under {@code format}, or {@code null} when
     * it does not fit.
     */
    public static BigDecimal parse(String value, String format) {
        if (format == null) {
            return plain(value);
        }
        char group;
        char decimal;
        switch (format) {
            case GROUPED -> { group = ','; decimal = '.'; }
            case EU -> { group = '.'; decimal = ','; }
            case DECORATED -> { group = 0; decimal = '.'; }
            default -> throw new IllegalArgumentException("Unknown number format label");
        }
        return decorated(value, group, decimal);
    }

    private static BigDecimal plain(String value) {
        // BigDecimal accepts these, but they are not how a spreadsheet writes a number.
        if (value.isEmpty() || value.length() > 64) {
            return null;
        }
        try {
            return new BigDecimal(value);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static BigDecimal decorated(String value, char group, char decimal) {
        int start = 0;
        int end = value.length();
        boolean negative = false;
        if (end - start >= 2 && value.charAt(start) == '(' && value.charAt(end - 1) == ')') {
            negative = true;
            start++;
            end--;
        }
        if (start < end && (value.charAt(start) == '-' || value.charAt(start) == '+')) {
            negative ^= value.charAt(start) == '-';
            start++;
        }
        if (start < end && CURRENCY.indexOf(value.charAt(start)) >= 0) {
            start++;
            if (start < end && isSpace(value.charAt(start))) start++;
        }
        if (start < end && value.charAt(start) == '-' && !negative) {
            negative = true; // "$-12"
            start++;
        }
        if (start < end && (value.charAt(end - 1) == '%' || CURRENCY.indexOf(value.charAt(end - 1)) >= 0)) {
            end--; // "45%", "12,50 €"
            if (start < end && isSpace(value.charAt(end - 1))) end--;
        }
        String digits = digits(value, start, end, group, decimal);
        if (digits == null) {
            return null;
        }
        BigDecimal number = new BigDecimal(digits);
        return negative ? number.negate() : number;
    }

    /** A plain, no-break or narrow no-break space: what French and Swiss exports group with. */
    private static boolean isSpace(char ch) {
        return ch == ' ' || ch == '\u00A0' || ch == '\u202F';
    }

    /**
     * The canonical "1234.5" for the integer part (with groups of exactly three after the first
     * when {@code group} is set) and optional fraction between {@code start} and {@code end}.
     */
    private static String digits(String value, int start, int end, char group, char decimal) {
        if (start >= end || end - start > 64) {
            return null;
        }
        StringBuilder out = new StringBuilder(end - start);
        int groupDigits = -1; // digits since the last group separator; -1 before the first
        int leading = 0;      // digits before the first separator
        boolean grouped = false;
        int i = start;
        for (; i < end; i++) {
            char ch = value.charAt(i);
            if (ch >= '0' && ch <= '9') {
                out.append(ch);
                if (grouped) groupDigits++; else leading++;
            } else if (group != 0 && (ch == group || (group == '.' && isSpace(ch)))) {
                if ((grouped && groupDigits != 3) || (!grouped && (leading == 0 || leading > 3))) {
                    return null;
                }
                grouped = true;
                groupDigits = 0;
            } else if (ch == decimal) {
                break;
            } else {
                return null;
            }
        }
        if (out.isEmpty() || (grouped && groupDigits != 3)) {
            return null;
        }
        if (i < end) { // at the decimal separator
            out.append('.');
            int fraction = 0;
            for (i++; i < end; i++) {
                char ch = value.charAt(i);
                if (ch < '0' || ch > '9') {
                    return null;
                }
                out.append(ch);
                fraction++;
            }
            if (fraction == 0) {
                return null;
            }
        }
        return out.toString();
    }
}
