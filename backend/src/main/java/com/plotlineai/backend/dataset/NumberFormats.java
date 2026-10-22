package com.plotlineai.backend.dataset;

import java.math.BigDecimal;
import java.util.List;
import java.util.Locale;
import java.util.Set;

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

    /**
     * {@code number:unit:in}: a number, a space, then the same unit on every value of the
     * column ({@code 6 in}, {@code 3.5 km}). The unit is at most {@link #MAX_UNIT_CHARS}
     * letters and unit signs, so a label never carries arbitrary text into the prompt, the API
     * or an event; mixed units stay text rather than being converted silently.
     */
    static final String UNIT_PREFIX = "number:unit:";
    static final int MAX_UNIT_CHARS = 8;

    /** Unit signs allowed beside letters: degrees, per, squared, cubed, micro. */
    private static final String UNIT_SIGNS = "°/²³µ";

    /** Month names read as a unit would turn "12 Jan" into the number 12. */
    private static final Set<String> MONTHS = Set.of("jan", "feb", "mar", "apr", "may", "jun",
        "jul", "aug", "sep", "sept", "oct", "nov", "dec", "january", "february", "march", "april",
        "june", "july", "august", "september", "october", "november", "december");

    public static boolean isLabel(String format) {
        return GROUPED.equals(format) || EU.equals(format) || DECORATED.equals(format)
            || unitOf(format) != null;
    }

    /** The unit of a {@code number:unit:} label, or {@code null} for any other format. */
    public static String unitOf(String format) {
        if (format == null || !format.startsWith(UNIT_PREFIX)) {
            return null;
        }
        String unit = format.substring(UNIT_PREFIX.length());
        return isUnit(unit) ? unit : null;
    }

    /**
     * The unit label {@code value} suggests, when it is a number, a space and a unit: the label
     * inference then tries on the whole column. {@code null} when it is anything else.
     */
    static String unitLabel(String value) {
        int space = lastSpace(value);
        if (space <= 0) {
            return null;
        }
        String unit = value.substring(space + 1);
        if (!isUnit(unit) || plainOrGrouped(value.substring(0, space).strip()) == null) {
            return null;
        }
        return UNIT_PREFIX + unit;
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
            default -> {
                String unit = unitOf(format);
                if (unit == null) {
                    throw new IllegalArgumentException("Unknown number format label");
                }
                return withUnit(value, unit);
            }
        }
        return decorated(value, group, decimal);
    }

    private static BigDecimal withUnit(String value, String unit) {
        int space = lastSpace(value);
        if (space <= 0 || !value.substring(space + 1).equals(unit)) {
            return null;
        }
        return plainOrGrouped(value.substring(0, space).strip());
    }

    private static BigDecimal plainOrGrouped(String number) {
        BigDecimal plain = plain(number);
        return plain != null ? plain : decorated(number, ',', '.');
    }

    private static int lastSpace(String value) {
        for (int i = value.length() - 1; i >= 0; i--) {
            if (isSpace(value.charAt(i))) {
                return i;
            }
        }
        return -1;
    }

    private static boolean isUnit(String unit) {
        if (unit.isEmpty() || unit.length() > MAX_UNIT_CHARS || MONTHS.contains(unit.toLowerCase(Locale.ROOT))) {
            return false;
        }
        boolean named = false;
        for (int i = 0; i < unit.length(); i++) {
            char ch = unit.charAt(i);
            if (Character.isLetter(ch)) {
                named = true;
            } else if (UNIT_SIGNS.indexOf(ch) < 0) {
                return false;
            }
            if (ch == '°') {
                named = true;
            }
        }
        return named;
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
