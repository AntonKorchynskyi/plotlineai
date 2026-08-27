package com.plotlineai.backend.dataset;

import com.plotlineai.backend.dataset.dto.ColumnSchema;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public class SchemaInferrer {

    private static final DateTimeFormatter[] DATE_FORMATTERS = {
        DateTimeFormatter.ISO_LOCAL_DATE,
        DateTimeFormatter.ofPattern("yyyy/MM/dd"),
        DateTimeFormatter.ofPattern("MM/dd/yyyy"),
        DateTimeFormatter.ISO_LOCAL_DATE_TIME
    };

    public List<ColumnSchema> infer(ParsedCsv csv) {
        List<String> headers = csv.headers();
        List<List<String>> rows = csv.rows();

        return headers.stream()
            .mapToInt(headers::indexOf)
            .mapToObj(colIndex -> inferColumn(headers.get(colIndex), rows, colIndex))
            .toList();
    }

    private ColumnSchema inferColumn(String columnName, List<List<String>> rows, int colIndex) {
        List<String> values = rows.stream()
            .map(row -> row.get(colIndex))
            .toList();

        // Separate null and non-null values
        List<String> nonNullValues = values.stream()
            .map(String::trim)
            .filter(v -> !v.isEmpty())
            .toList();

        long nullCount = values.size() - nonNullValues.size();

        // If all values are null, type is STRING
        if (nonNullValues.isEmpty()) {
            return new ColumnSchema(columnName, ColumnType.STRING, 0, nullCount);
        }

        // Calculate cardinality from non-null trimmed values
        Set<String> distinctValues = new HashSet<>(nonNullValues);
        long cardinality = distinctValues.size();

        // Determine type
        ColumnType type = inferType(nonNullValues);

        return new ColumnSchema(columnName, type, cardinality, nullCount);
    }

    private ColumnType inferType(List<String> nonNullValues) {
        // Try INTEGER
        if (canParseAsInteger(nonNullValues)) {
            return ColumnType.INTEGER;
        }

        // Try DECIMAL
        if (canParseAsDecimal(nonNullValues)) {
            return ColumnType.DECIMAL;
        }

        // Try BOOLEAN
        if (canParseAsBoolean(nonNullValues)) {
            return ColumnType.BOOLEAN;
        }

        // Try DATE
        if (canParseAsDate(nonNullValues)) {
            return ColumnType.DATE;
        }

        // Default to STRING
        return ColumnType.STRING;
    }

    private boolean canParseAsInteger(List<String> values) {
        for (String value : values) {
            try {
                Long.parseLong(value);
            } catch (NumberFormatException e) {
                return false;
            }
        }
        return true;
    }

    private boolean canParseAsDecimal(List<String> values) {
        for (String value : values) {
            try {
                new BigDecimal(value);
            } catch (NumberFormatException e) {
                return false;
            }
        }
        return true;
    }

    private boolean canParseAsBoolean(List<String> values) {
        for (String value : values) {
            if (!value.equalsIgnoreCase("true") && !value.equalsIgnoreCase("false")) {
                return false;
            }
        }
        return true;
    }

    private boolean canParseAsDate(List<String> values) {
        // Try to find a single formatter that works for all values
        for (DateTimeFormatter formatter : DATE_FORMATTERS) {
            if (canParseAllWithFormatter(values, formatter)) {
                return true;
            }
        }
        return false;
    }

    private boolean canParseAllWithFormatter(List<String> values, DateTimeFormatter formatter) {
        for (String value : values) {
            try {
                // Try parsing as LocalDateTime first, then LocalDate
                try {
                    LocalDateTime.parse(value, formatter);
                } catch (Exception e1) {
                    try {
                        LocalDate.parse(value, formatter);
                    } catch (Exception e2) {
                        return false;
                    }
                }
            } catch (Exception e) {
                return false;
            }
        }
        return true;
    }
}
