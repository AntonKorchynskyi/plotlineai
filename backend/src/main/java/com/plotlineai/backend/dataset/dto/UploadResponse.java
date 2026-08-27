package com.plotlineai.backend.dataset.dto;

import java.util.List;
import java.util.UUID;

public record UploadResponse(UUID datasetId, List<ColumnSchema> schema, int rowCount) {
}
