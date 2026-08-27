package com.plotlineai.backend.dataset.dto;

import com.plotlineai.backend.dataset.ColumnType;

public record ColumnSchema(
        String name,
        ColumnType type,
        long cardinality,
        long nullCount,
        String format) {
}
