package com.plotlineai.backend.dataset.dto;

import java.util.List;
import java.util.Map;
import java.util.UUID;

public record DatasetDetailResponse(
        UUID datasetId,
        List<ColumnSchema> schema,
        int rowCount,
        List<Map<String, String>> sampleRows) {
}
