package com.plotlineai.backend.dataset;

import java.util.Locale;
import java.util.Set;

/**
 * Text that spreadsheets and exports put in a cell that has no value. It counts as missing only
 * in a numeric, date or boolean column: in a text column "NA" may well be North America.
 */
public final class MissingValues {

    private static final Set<String> PLACEHOLDERS =
        Set.of("n/a", "na", "#n/a", "null", "none", "nan", "-", "--");

    private MissingValues() {
    }

    /** {@code value} must already be trimmed. */
    public static boolean isPlaceholder(String value) {
        return PLACEHOLDERS.contains(value.toLowerCase(Locale.ROOT));
    }
}
